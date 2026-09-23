using System.Globalization; using System.Net; using System.Text.Json; using Microsoft.EntityFrameworkCore; using Microsoft.Extensions.Configuration; using Microsoft.Extensions.DependencyInjection; using Microsoft.Extensions.Hosting; using Microsoft.Extensions.Logging; using WebPush;
namespace TaskFlow.Infrastructure;
/* Scans every user who has at least one push subscription for due task/event reminders, entirely server-side,
   so a notification can wake a device even when no browser tab is open. Dedup is tracked in SentReminder
   (not by mutating the client's task/event JSON) to avoid racing with the client's own local reminder check. */
public sealed class ReminderPushBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<ReminderPushBackgroundService> logger) : BackgroundService {
 protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
  var publicKey = config["Vapid:PublicKey"]; var privateKey = config["Vapid:PrivateKey"]; var subject = config["Vapid:Subject"];
  if (string.IsNullOrEmpty(publicKey) || string.IsNullOrEmpty(privateKey) || string.IsNullOrEmpty(subject)) {
   logger.LogWarning("VAPID keys not configured; push reminder background service is disabled.");
   return;
  }
  var vapid = new VapidDetails(subject, publicKey, privateKey);
  var client = new WebPushClient();
  using var timer = new PeriodicTimer(TimeSpan.FromSeconds(60));
  do {
   try { await TickAsync(client, vapid, stoppingToken); }
   catch (Exception ex) { logger.LogError(ex, "Reminder push tick failed"); }
  } while (await timer.WaitForNextTickAsync(stoppingToken));
 }
 async Task TickAsync(WebPushClient client, VapidDetails vapid, CancellationToken ct) {
  using var scope = scopeFactory.CreateScope();
  var db = scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>();
  var now = DateTimeOffset.UtcNow;
  var userIds = await db.PushSubscriptions.Select(x => x.UserId).Distinct().ToListAsync(ct);
  foreach (var userId in userIds) {
   var subs = await db.PushSubscriptions.Where(x => x.UserId == userId).ToListAsync(ct);
   if (subs.Count == 0) continue;
   var tzOffsetMinutes = subs[0].TzOffsetMinutes;
   var entries = await db.UserData.Where(x => x.UserId == userId).ToListAsync(ct);
   var due = new List<(string Kind, string ItemKey, string Title, string Body, bool Important)>();
   CollectDueTaskReminders(entries, now, tzOffsetMinutes, due);
   CollectDueEventReminders(entries, now, tzOffsetMinutes, due);
   if (due.Count == 0) continue;
   foreach (var item in due) {
    if (await db.SentReminders.AnyAsync(x => x.UserId == userId && x.Kind == item.Kind && x.ItemKey == item.ItemKey, ct)) continue;
    db.SentReminders.Add(new() { UserId = userId, Kind = item.Kind, ItemKey = item.ItemKey });
    var payload = JsonSerializer.Serialize(new { title = item.Title, body = item.Body, important = item.Important });
    foreach (var sub in subs.ToList()) {
     try { await client.SendNotificationAsync(new WebPush.PushSubscription(sub.Endpoint, sub.P256dh, sub.Auth), payload, vapid); }
     catch (WebPushException wpEx) when (wpEx.StatusCode is HttpStatusCode.Gone or HttpStatusCode.NotFound) { db.PushSubscriptions.Remove(sub); subs.Remove(sub); }
     catch (Exception ex) { logger.LogWarning(ex, "Push send failed for subscription {SubId}", sub.Id); }
    }
   }
   await db.SaveChangesAsync(ct);
  }
 }
 static void CollectDueTaskReminders(List<Domain.UserDataEntry> entries, DateTimeOffset now, int tzOffsetMinutes, List<(string, string, string, string, bool)> due) {
  var json = entries.FirstOrDefault(x => x.Key.StartsWith("taskflow_tasks_", StringComparison.Ordinal))?.ValueJson;
  if (json is null) return;
  List<JsonElement>? tasks;
  try { tasks = JsonSerializer.Deserialize<List<JsonElement>>(json); } catch { return; }
  if (tasks is null) return;
  foreach (var t in tasks) {
   if (!t.TryGetProperty("reminder", out var remEl) || remEl.ValueKind != JsonValueKind.String) continue;
   var raw = remEl.GetString();
   if (string.IsNullOrEmpty(raw)) continue;
   if (!DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out var localTime)) continue;
   if (!t.TryGetProperty("id", out var idEl)) continue;
   var id = idEl.ToString();
   var title = t.TryGetProperty("title", out var titleEl) ? titleEl.GetString() ?? "Task" : "Task";
   var important = t.TryGetProperty("important", out var impEl) && impEl.ValueKind == JsonValueKind.True;
   var utc = LocalToUtc(localTime, tzOffsetMinutes);
   var age = now - utc;
   if (utc <= now && age < TimeSpan.FromMinutes(5)) due.Add(("task", id, "Reminder: " + title, $"Task \"{title}\" is due!", important));
  }
 }
 static void CollectDueEventReminders(List<Domain.UserDataEntry> entries, DateTimeOffset now, int tzOffsetMinutes, List<(string, string, string, string, bool)> due) {
  var json = entries.FirstOrDefault(x => x.Key.StartsWith("taskflow_events_", StringComparison.Ordinal))?.ValueJson;
  if (json is null) return;
  List<JsonElement>? events;
  try { events = JsonSerializer.Deserialize<List<JsonElement>>(json); } catch { return; }
  if (events is null) return;
  foreach (var ev in events) {
   if (!ev.TryGetProperty("remindBefore", out var rbEl) || rbEl.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) continue;
   if (!ev.TryGetProperty("date", out var dateEl)) continue;
   var date = dateEl.GetString(); if (string.IsNullOrEmpty(date)) continue;
   var time = ev.TryGetProperty("time", out var timeEl) ? (timeEl.GetString() ?? "00:00") : "00:00";
   if (string.IsNullOrEmpty(time)) time = "00:00";
   if (!DateTime.TryParse($"{date}T{time}:00", CultureInfo.InvariantCulture, DateTimeStyles.None, out var localEventTime)) continue;
   if (!ev.TryGetProperty("id", out var idEl)) continue;
   var id = idEl.ToString();
   var title = ev.TryGetProperty("title", out var titleEl) ? titleEl.GetString() ?? "Event" : "Event";
   var important = ev.TryGetProperty("important", out var impEl) && impEl.ValueKind == JsonValueKind.True;
   var remindBefore = rbEl.ValueKind == JsonValueKind.Number ? rbEl.GetDouble() : 0;
   var triggerUtc = LocalToUtc(localEventTime, tzOffsetMinutes).AddMinutes(-remindBefore);
   var age = now - triggerUtc;
   if (triggerUtc <= now && age < TimeSpan.FromMinutes(5)) due.Add(("event", id, title, "Coming up now", important));
  }
 }
 static DateTimeOffset LocalToUtc(DateTime naiveLocal, int tzOffsetMinutes) => new DateTimeOffset(DateTime.SpecifyKind(naiveLocal, DateTimeKind.Unspecified), TimeSpan.Zero).AddMinutes(tzOffsetMinutes);
}
