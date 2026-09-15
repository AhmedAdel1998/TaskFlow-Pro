using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Testcontainers.PostgreSql;
using TaskFlow.Infrastructure;

namespace TaskFlow.IntegrationTests;

public sealed class RateLimitApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    readonly PostgreSqlContainer _db = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Jwt:Key", "integration-test-signing-key-not-used-in-production-0123456789");
        builder.UseSetting("ConnectionStrings:TaskFlow", "Host=localhost;Port=1;Database=placeholder");
        builder.UseSetting("RateLimits:Auth", "3");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<TaskFlowDbContext>>();
            services.AddDbContext<TaskFlowDbContext>(o => o.UseNpgsql(_db.GetConnectionString()));
        });
    }

    public async Task InitializeAsync()
    {
        await _db.StartAsync();
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>();
        await db.Database.MigrateAsync();
    }

    public new async Task DisposeAsync()
    {
        await _db.DisposeAsync();
        await base.DisposeAsync();
    }
}
