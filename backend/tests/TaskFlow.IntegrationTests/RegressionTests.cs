using System.Net;
using System.Net.Http.Json;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using TaskFlow.Application;
using TaskFlow.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TaskFlow.Infrastructure;

namespace TaskFlow.IntegrationTests;

public class RegressionTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    async Task<(HttpClient Client, AuthResult Auth)> Account()
    {
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterCommand("r" + Guid.NewGuid().ToString("N")[..25], "password123", "Test"));
        response.EnsureSuccessStatusCode();
        var auth = (await response.Content.ReadFromJsonAsync<AuthResult>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", auth.AccessToken);
        return (client, auth);
    }

    [Fact]
    public async Task Refresh_is_single_use_even_with_concurrent_requests_and_logout_revokes()
    {
        var (client, auth) = await Account();
        var results = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ =>
            client.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = auth.RefreshToken })));
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Equal(4, results.Count(r => r.StatusCode == HttpStatusCode.Unauthorized));
        var rotated = (await results.Single(r => r.IsSuccessStatusCode).Content.ReadFromJsonAsync<AuthResult>())!;
        Assert.NotEqual(auth.RefreshToken, rotated.RefreshToken);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/auth/logout", new { refreshToken = rotated.RefreshToken })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = rotated.RefreshToken })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = "invalid" })).StatusCode);
    }

    [Fact]
    public async Task Expired_access_token_has_no_grace_period()
    {
        var (client, auth) = await Account();
        var claims = new JwtSecurityTokenHandler().ReadJwtToken(auth.AccessToken).Claims.Where(c => c.Type != "exp");
        var token = new JwtSecurityToken(claims: claims, expires: DateTime.UtcNow.AddSeconds(-1),
            signingCredentials: new(new SymmetricSecurityKey(Encoding.UTF8.GetBytes("integration-test-signing-key-not-used-in-production-0123456789")), SecurityAlgorithms.HmacSha256));
        client.DefaultRequestHeaders.Authorization = new("Bearer", new JwtSecurityTokenHandler().WriteToken(token));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/data")).StatusCode);
    }

    [Fact]
    public async Task Data_is_user_scoped_and_stale_edits_are_rejected_without_losing_content()
    {
        var (a, _) = await Account(); var (b, _) = await Account();
        var first = await a.PutAsJsonAsync("/api/data/test", new UpsertDataCommand("[]", null, true));
        first.EnsureSuccessStatusCode();
        var item = (await first.Content.ReadFromJsonAsync<UserDataItem>())!;
        Assert.Empty((await b.GetFromJsonAsync<List<UserDataItem>>("/api/data"))!);
        await b.DeleteAsync("/api/data/test");
        Assert.Single((await a.GetFromJsonAsync<List<UserDataItem>>("/api/data"))!);
        (await a.PutAsJsonAsync("/api/data/test", new UpsertDataCommand("[1]", item.UpdatedAt, true))).EnsureSuccessStatusCode();
        // The first response may be lost on reload: retrying the same desired value is safe.
        (await a.PutAsJsonAsync("/api/data/test", new UpsertDataCommand("[1]", item.UpdatedAt, true))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await a.PutAsJsonAsync("/api/data/test", new UpsertDataCommand("[2]", item.UpdatedAt, true))).StatusCode);
        Assert.Equal("[1]", (await a.GetFromJsonAsync<List<UserDataItem>>("/api/data"))!.Single().Value);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsJsonAsync("/api/data/test", new { value = (string?)null })).StatusCode);
        await a.DeleteAsync("/api/data/test");
        Assert.Empty((await a.GetFromJsonAsync<List<UserDataItem>>("/api/data"))!);
    }

    [Fact]
    public async Task Projects_tags_comments_and_task_references_cannot_cross_organizations()
    {
        var (a, _) = await Account(); var (b, _) = await Account();
        var project = (await (await a.PostAsJsonAsync("/api/projects", new CreateProjectCommand("private", null))).Content.ReadFromJsonAsync<ProjectDto>())!;
        await a.PostAsJsonAsync("/api/tags", new CreateTagCommand("private"));
        Assert.Empty((await b.GetFromJsonAsync<List<ProjectDto>>("/api/projects"))!);
        Assert.Empty((await b.GetFromJsonAsync<List<TagDto>>("/api/tags"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync("/api/tasks", new CreateTaskCommand("bad reference", null, project.Id, null, "high", null))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync("/api/tasks", new CreateTaskCommand("bad owner", null, null, Guid.NewGuid(), "high", null))).StatusCode);
        var task = (await (await a.PostAsJsonAsync("/api/tasks", new CreateTaskCommand("test", null, project.Id, null, "high", null))).Content.ReadFromJsonAsync<TaskDto>())!;
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/tasks/{task.Id}/comments")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync($"/api/tasks/{task.Id}/comments", new CreateCommentCommand("attack"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsJsonAsync($"/api/tasks/{task.Id}", new UpdateTaskCommand(" ", null, TaskState.Done, "high", null, task.Version))).StatusCode);
    }

    [Theory]
    [InlineData("/api/data")]
    [InlineData("/api/projects")]
    [InlineData("/api/tags")]
    public async Task Anonymous_data_endpoints_are_protected(string path)
        => Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync(path)).StatusCode);

    [Fact]
    public async Task Null_and_short_passwords_are_bad_requests_and_health_is_ready()
    {
        var client = factory.CreateClient();
        foreach (var password in new string?[] { null, "12345" })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/auth/register", new { username = "shortuser", password, organizationName = "Test" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
        var request = new HttpRequestMessage(HttpMethod.Options, "/api/data");
        request.Headers.Add("Origin", "https://untrusted.example");
        request.Headers.Add("Access-Control-Request-Method", "PUT");
        Assert.False((await client.SendAsync(request)).Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task Push_rejects_arbitrary_server_side_request_targets()
    {
        var (client, _) = await Account();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/push/subscribe",
            new PushSubscribeCommand("http://127.0.0.1/private", "key", "auth", 0))).StatusCode);
    }

    [Fact]
    public async Task Expired_refresh_and_disabled_users_are_rejected()
    {
        var (client, auth)=await Account();
        var user=Guid.Parse(new JwtSecurityTokenHandler().ReadJwtToken(auth.AccessToken).Claims.Single(c=>c.Type=="sub").Value);
        using var scope=factory.Services.CreateScope();
        var db=scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>();
        var session=await db.RefreshSessions.SingleAsync(s=>s.UserId==user);
        session.ExpiresAt=DateTimeOffset.UtcNow.AddDays(-1);await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Unauthorized,(await client.PostAsJsonAsync("/api/auth/refresh",new{refreshToken=auth.RefreshToken})).StatusCode);
        var account=await db.Users.FindAsync(user);account!.IsDisabled=true;await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Unauthorized,(await client.GetAsync("/api/data")).StatusCode);
    }

    [Fact]
    public async Task Push_ownership_transfers_on_browser_account_switch_and_unsubscribe_is_scoped()
    {
        var (a, _) = await Account();var (b, _) = await Account();
        var endpoint="https://fcm.googleapis.com/test-"+Guid.NewGuid();
        var subscription=new PushSubscribeCommand(endpoint,"mock-key","mock-auth",-180);
        (await a.PostAsJsonAsync("/api/push/subscribe",subscription)).EnsureSuccessStatusCode();
        (await b.PostAsJsonAsync("/api/push/subscribe",subscription)).EnsureSuccessStatusCode();
        (await a.PostAsJsonAsync("/api/push/unsubscribe",new{endpoint})).EnsureSuccessStatusCode();
        using var scope=factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>();
        Assert.Equal(1,await db.PushSubscriptions.CountAsync(s=>s.Endpoint==endpoint));
        (await b.PostAsJsonAsync("/api/push/unsubscribe",new{endpoint})).EnsureSuccessStatusCode();
        Assert.Equal(0,await db.PushSubscriptions.CountAsync(s=>s.Endpoint==endpoint));
    }
}
