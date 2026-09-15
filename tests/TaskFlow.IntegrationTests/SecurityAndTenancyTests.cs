using System.Net;
using System.Net.Http.Json;
using TaskFlow.Application;
using TaskFlow.Domain;
using Xunit;

namespace TaskFlow.IntegrationTests;

public class SecurityAndTenancyTests : IClassFixture<ApiFactory>
{
    readonly ApiFactory _factory;
    public SecurityAndTenancyTests(ApiFactory factory) => _factory = factory;

    static int _counter;
    static string NextEmail() => $"user{Interlocked.Increment(ref _counter)}@example.com";

    async Task<(HttpClient client, AuthResult auth)> RegisterAsync(HttpClient client, string org)
    {
        var res = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterCommand(NextEmail(), "correct-horse-battery-staple", org));
        res.EnsureSuccessStatusCode();
        var auth = (await res.Content.ReadFromJsonAsync<AuthResult>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", auth.AccessToken);
        return (client, auth);
    }

    [Fact]
    public async Task Register_then_create_task_succeeds()
    {
        var (client, _) = await RegisterAsync(_factory.CreateClient(), "Org A");
        var res = await client.PostAsJsonAsync("/api/tasks",
            new CreateTaskCommand("Ship the feature", null, null, null, "high", null));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task Task_list_is_isolated_per_organization()
    {
        var (clientA, _) = await RegisterAsync(_factory.CreateClient(), "Org A " + Guid.NewGuid());
        var (clientB, _) = await RegisterAsync(_factory.CreateClient(), "Org B " + Guid.NewGuid());

        var created = await clientA.PostAsJsonAsync("/api/tasks",
            new CreateTaskCommand("Org A confidential task", null, null, null, "high", null));
        var taskA = (await created.Content.ReadFromJsonAsync<TaskDto>())!;

        var listB = await clientB.GetFromJsonAsync<List<TaskDto>>("/api/tasks");
        Assert.DoesNotContain(listB!, t => t.Id == taskA.Id);

        // Org B cannot even address org A's task by id - update must 404, not leak existence.
        var update = await clientB.PutAsJsonAsync($"/api/tasks/{taskA.Id}",
            new UpdateTaskCommand("hijacked", null, TaskState.Done, "low", null, taskA.Version));
        Assert.Equal(HttpStatusCode.NotFound, update.StatusCode);
    }

    [Fact]
    public async Task Anonymous_request_is_rejected()
    {
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/api/tasks");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Concurrent_update_with_stale_version_returns_conflict()
    {
        var (client, _) = await RegisterAsync(_factory.CreateClient(), "Org C " + Guid.NewGuid());
        var created = await client.PostAsJsonAsync("/api/tasks",
            new CreateTaskCommand("Race condition target", null, null, null, "medium", null));
        var task = (await created.Content.ReadFromJsonAsync<TaskDto>())!;

        var first = await client.PutAsJsonAsync($"/api/tasks/{task.Id}",
            new UpdateTaskCommand("updated once", null, TaskState.InProgress, "medium", null, task.Version));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        // Retry with the now-stale version the client originally read.
        var stale = await client.PutAsJsonAsync($"/api/tasks/{task.Id}",
            new UpdateTaskCommand("updated twice", null, TaskState.Done, "medium", null, task.Version));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
    }

    [Fact]
    public async Task Empty_title_is_rejected_server_side()
    {
        var (client, _) = await RegisterAsync(_factory.CreateClient(), "Org D " + Guid.NewGuid());
        var res = await client.PostAsJsonAsync("/api/tasks",
            new CreateTaskCommand("   ", null, null, null, "medium", null));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Duplicate_registration_email_is_rejected()
    {
        var email = NextEmail();
        var client = _factory.CreateClient();
        var first = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterCommand(email, "correct-horse-battery-staple", "Org E"));
        first.EnsureSuccessStatusCode();

        var second = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterCommand(email, "another-long-enough-password", "Org F"));
        Assert.Equal(HttpStatusCode.BadRequest, second.StatusCode);
    }

    [Fact]
    public async Task Login_with_wrong_password_is_rejected()
    {
        var email = NextEmail();
        var client = _factory.CreateClient();
        (await client.PostAsJsonAsync("/api/auth/register",
            new RegisterCommand(email, "correct-horse-battery-staple", "Org G"))).EnsureSuccessStatusCode();

        var res = await client.PostAsJsonAsync("/api/auth/login", new LoginCommand(email, "wrong-password-entirely"));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Subtasks_and_comments_are_tenant_scoped()
    {
        var (clientA, _) = await RegisterAsync(_factory.CreateClient(), "Org H " + Guid.NewGuid());
        var (clientB, _) = await RegisterAsync(_factory.CreateClient(), "Org I " + Guid.NewGuid());

        var created = await clientA.PostAsJsonAsync("/api/tasks",
            new CreateTaskCommand("Task with children", null, null, null, "medium", null));
        var task = (await created.Content.ReadFromJsonAsync<TaskDto>())!;

        var sub = await clientA.PostAsJsonAsync($"/api/tasks/{task.Id}/subtasks", new CreateSubtaskCommand("Step 1"));
        Assert.Equal(HttpStatusCode.OK, sub.StatusCode);

        var comment = await clientA.PostAsJsonAsync($"/api/tasks/{task.Id}/comments", new CreateCommentCommand("looks good"));
        Assert.Equal(HttpStatusCode.OK, comment.StatusCode);

        // Org B cannot see or attach children to org A's task.
        var subB = await clientB.PostAsJsonAsync($"/api/tasks/{task.Id}/subtasks", new CreateSubtaskCommand("Injected"));
        Assert.Equal(HttpStatusCode.NotFound, subB.StatusCode);

        var listB = await clientB.GetAsync($"/api/tasks/{task.Id}/subtasks");
        Assert.Equal(HttpStatusCode.NotFound, listB.StatusCode);
    }
}
