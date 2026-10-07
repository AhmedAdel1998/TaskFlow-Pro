using System.Net;
using System.Net.Http.Json;
using TaskFlow.Application;
using Xunit;

namespace TaskFlow.IntegrationTests;

public class RateLimitTests : IClassFixture<RateLimitApiFactory>
{
    readonly RateLimitApiFactory _factory;
    public RateLimitTests(RateLimitApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Auth_endpoints_are_rate_limited_after_the_configured_threshold()
    {
        var client = _factory.CreateClient();
        HttpStatusCode? limited = null;
        for (var i = 0; i < 6; i++)
        {
            var res = await client.PostAsJsonAsync("/api/auth/login",
                new LoginCommand("nobody@example.com", "wrong-password"));
            if (res.StatusCode == (HttpStatusCode)429)
            {
                limited = res.StatusCode;
                break;
            }
        }
        Assert.Equal((HttpStatusCode)429, limited);
    }
}
