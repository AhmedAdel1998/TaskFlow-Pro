using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TaskFlow.Domain;
using TaskFlow.Infrastructure;
using WebPush;

namespace TaskFlow.IntegrationTests;

public class ReminderTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    sealed class FakeSender : IReminderPushSender
    {
        public bool Fail;
        public bool Expired;
        public string? FailedEndpoint;
        public readonly List<string> Payloads = [];
        public Task SendAsync(WebPush.PushSubscription subscription, string payload, VapidDetails vapid, CancellationToken ct)
        {
            if (Expired) throw new WebPushException("Expired subscription", subscription, new System.Net.Http.HttpResponseMessage(System.Net.HttpStatusCode.Gone));
            if (Fail || subscription.Endpoint == FailedEndpoint) throw new HttpRequestException("Simulated push outage");
            Payloads.Add(payload); return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task Automatic_alarms_send_without_custom_reminders_and_retry_each_device()
    {
        var user=Guid.NewGuid(); var username="auto"+user.ToString("N")[..20];
        var time=DateTimeOffset.UtcNow.AddMinutes(-1);
        using var scope=factory.Services.CreateScope();
        var db=scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>();
        db.Users.Add(new(){Id=user,Username=username,PasswordHash="test-only"});
        db.PushSubscriptions.AddRange(
            new(){UserId=user,Endpoint="https://fcm.googleapis.com/auto-ok",Auth="mock",P256dh="mock"},
            new(){UserId=user,Endpoint="https://fcm.googleapis.com/auto-retry",Auth="mock",P256dh="mock"});
        db.UserData.Add(new(){UserId=user,Key="taskflow_tasks_"+username,ValueJson=JsonSerializer.Serialize(new[]{
            new{id="auto",important=true,due=time.ToString("yyyy-MM-dd"),due_time=time.ToString("HH:mm"),reminderDismissed=true,reminderDelivery="local"},
            new{id="off",important=false,due=time.ToString("yyyy-MM-dd"),due_time=time.ToString("HH:mm"),reminderDismissed=false,reminderDelivery=""}
        })});
        db.UserData.Add(new(){UserId=user,Key="taskflow_timetable_blocks_"+username,ValueJson=JsonSerializer.Serialize(new[]{
            new{id="block",important=true,date=time.ToString("yyyy-MM-dd"),start=time.Hour*60+time.Minute}
        })});
        await db.SaveChangesAsync();
        var sender=new FakeSender{FailedEndpoint="https://fcm.googleapis.com/auto-retry"};
        var service=new ReminderPushBackgroundService(factory.Services.GetRequiredService<IServiceScopeFactory>(),new ConfigurationBuilder().Build(),NullLogger<ReminderPushBackgroundService>.Instance,sender);
        await service.TickAsync(new VapidDetails(),default);
        Assert.Equal(2,sender.Payloads.Count);
        sender.FailedEndpoint=null;
        await service.TickAsync(new VapidDetails(),default);
        Assert.Equal(4,sender.Payloads.Count);
        await service.TickAsync(new VapidDetails(),default);
        Assert.Equal(4,sender.Payloads.Count);
        db.PushSubscriptions.RemoveRange(db.PushSubscriptions.Where(s=>s.UserId==user));await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Expired_provider_subscription_is_removed()
    {
        var user=Guid.NewGuid();
        using var scope=factory.Services.CreateScope();
        var db=scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>();
        db.Users.Add(new(){Id=user,Username="reminder"+user.ToString("N")[..20],PasswordHash="test-only"});
        db.PushSubscriptions.Add(new(){UserId=user,Endpoint="https://fcm.googleapis.com/expired",Auth="mock",P256dh="mock"});
        db.UserData.Add(new(){UserId=user,Key="taskflow_tasks_reminder"+user.ToString("N")[..20],ValueJson=JsonSerializer.Serialize(new[]{new{id="expired",title="Expired",reminder=DateTimeOffset.UtcNow.AddMinutes(-1).ToString("s")}})});
        await db.SaveChangesAsync();
        var service=new ReminderPushBackgroundService(factory.Services.GetRequiredService<IServiceScopeFactory>(),new ConfigurationBuilder().Build(),NullLogger<ReminderPushBackgroundService>.Instance,new FakeSender{Expired=true});
        await service.TickAsync(new VapidDetails(),default);
        Assert.False(await db.PushSubscriptions.AnyAsync(s=>s.UserId==user));
        Assert.False(await db.SentReminders.AnyAsync(s=>s.UserId==user));
    }

    [Fact]
    public async Task Failed_delivery_retries_success_deduplicates_and_edited_time_rearms()
    {
        var user = Guid.NewGuid();
        var trigger = DateTimeOffset.UtcNow.AddMinutes(-1);
        string Data(DateTimeOffset time) => JsonSerializer.Serialize(new[] { new { id = "task", title = "Reminder", reminder = time.ToString("s"), reminderUtc = time.ToString("O"), important = true } });
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>();
        db.Users.Add(new(){Id=user,Username="reminder"+user.ToString("N")[..20],PasswordHash="test-only"});
        db.PushSubscriptions.Add(new() { UserId=user, Endpoint="https://fcm.googleapis.com/test", Auth="mock", P256dh="mock", TzOffsetMinutes=720 });
        var entry = new UserDataEntry { UserId=user, Key="taskflow_tasks_reminder"+user.ToString("N")[..20], ValueJson=Data(trigger) };
        db.UserData.Add(entry); await db.SaveChangesAsync();
        var sender = new FakeSender { Fail=true };
        var service = new ReminderPushBackgroundService(factory.Services.GetRequiredService<IServiceScopeFactory>(),
            new ConfigurationBuilder().Build(), NullLogger<ReminderPushBackgroundService>.Instance, sender);
        var vapid = new VapidDetails();
        await service.TickAsync(vapid, default);
        Assert.Empty(await db.SentReminders.Where(r=>r.UserId==user).ToListAsync());
        sender.Fail=false;
        await service.TickAsync(vapid, default);
        await service.TickAsync(vapid, default);
        Assert.Single(sender.Payloads);
        Assert.Contains("\"important\":true",sender.Payloads[0]);
        entry.ValueJson=Data(trigger.AddSeconds(10)); await db.SaveChangesAsync();
        await service.TickAsync(vapid, default);
        Assert.Equal(2,sender.Payloads.Count);
        db.PushSubscriptions.RemoveRange(db.PushSubscriptions.Where(s=>s.UserId==user));
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Completed_dismissed_and_malformed_records_do_not_send()
    {
        var user=Guid.NewGuid(); var time=DateTimeOffset.UtcNow.AddMinutes(-1).ToString("s");
        using var scope=factory.Services.CreateScope();
        var db=scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>();
        db.Users.Add(new(){Id=user,Username="reminder"+user.ToString("N")[..20],PasswordHash="test-only"});
        db.PushSubscriptions.Add(new(){UserId=user,Endpoint="https://fcm.googleapis.com/test2",Auth="mock",P256dh="mock"});
        db.UserData.Add(new(){UserId=user,Key="taskflow_tasks_reminder"+user.ToString("N")[..20],ValueJson=JsonSerializer.Serialize(new object?[]{null,3,new{id="done",title="Done",status="done",reminder=time},new{id="dismissed",reminderDismissed=true,reminder=time}})});
        await db.SaveChangesAsync();
        var sender=new FakeSender();
        var service=new ReminderPushBackgroundService(factory.Services.GetRequiredService<IServiceScopeFactory>(),new ConfigurationBuilder().Build(),NullLogger<ReminderPushBackgroundService>.Instance,sender);
        await service.TickAsync(new VapidDetails(),default);
        Assert.Empty(sender.Payloads);
        db.PushSubscriptions.RemoveRange(db.PushSubscriptions.Where(s=>s.UserId==user));await db.SaveChangesAsync();
    }
}
