using System.Globalization; using System.Net; using System.Text.Json; using Microsoft.EntityFrameworkCore; using Microsoft.Extensions.Configuration; using Microsoft.Extensions.DependencyInjection; using Microsoft.Extensions.Hosting; using Microsoft.Extensions.Logging; using WebPush;
namespace TaskFlow.Infrastructure;
/* Scans every user who has at least one push subscription for due task/event reminders, entirely server-side,
   so a notification can wake a device even when no browser tab is open. Dedup is tracked in SentReminder
   (not by mutating the client's task/event JSON) to avoid racing with the client's own local reminder check. */
public sealed class ReminderPushBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<ReminderPushBackgroundService> logger, IReminderPushSender sender) : BackgroundService {
 protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
  var publicKey = config["Vapid:PublicKey"]; var privateKey = config["Vapid:PrivateKey"]; var subject = config["Vapid:Subject"];
  if (string.IsNullOrEmpty(publicKey) || string.IsNullOrEmpty(privateKey) || string.IsNullOrEmpty(subject)) {
   logger.LogWarning("VAPID keys not configured; push reminder background service is disabled.");
   return;
  }
  var vapid = new VapidDetails(subject, publicKey, privateKey);

  using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
  do {
   try { await TickAsync(vapid, stoppingToken); }
   catch (Exception ex) { logger.LogError(ex, "Reminder push tick failed"); }
  } while (await timer.WaitForNextTickAsync(stoppingToken));
 }
 internal async Task TickAsync(VapidDetails vapid, CancellationToken ct) {
  using var scope = scopeFactory.CreateScope();
  var db = scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>();
  var now = DateTimeOffset.UtcNow;
  var userIds = await db.PushSubscriptions.Select(x => x.UserId).Distinct().ToListAsync(ct);
  foreach (var userId in userIds) {
   var username=await db.Users.Where(u=>u.Id==userId&&!u.IsDisabled).Select(u=>u.Username).SingleOrDefaultAsync(ct);
   if(username is null)continue;
   var subs = await db.PushSubscriptions.Where(x => x.UserId == userId).ToListAsync(ct);
   if (subs.Count == 0) continue;
   var tzOffsetMinutes = subs[0].TzOffsetMinutes;
   var entries = await db.UserData.Where(x => x.UserId == userId && (x.Key=="taskflow_tasks_"+username || x.Key=="taskflow_events_"+username || x.Key=="taskflow_timetable_blocks_"+username)).ToListAsync(ct);
   var due = new List<(string Kind, string ItemKey, string Title, string Body, bool Important)>();
   CollectDueTaskReminders(entries, now, tzOffsetMinutes, due);
   CollectDueEventReminders(entries, now, tzOffsetMinutes, due);
    CollectDueTimetableBlockReminders(entries, now, tzOffsetMinutes, due);
   if (due.Count == 0) continue;
   foreach (var item in due) {
    if (await db.SentReminders.AnyAsync(x => x.UserId == userId && x.Kind == item.Kind && x.ItemKey == item.ItemKey, ct)) continue;

    var payload = JsonSerializer.Serialize(new { title = item.Title, body = item.Body, important = item.Important, tag = item.Kind+"-"+item.ItemKey });
    foreach (var sub in subs.ToList()) {
     var deviceKey=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(item.ItemKey+"|"+sub.Id)));
     if(await db.SentReminders.AnyAsync(x=>x.UserId==userId&&x.Kind==item.Kind&&x.ItemKey==deviceKey,ct))continue;
     try {
      await sender.SendAsync(new WebPush.PushSubscription(sub.Endpoint, sub.P256dh, sub.Auth), payload, vapid, ct);
      db.SentReminders.Add(new(){UserId=userId,Kind=item.Kind,ItemKey=deviceKey});
      await db.SaveChangesAsync(ct);
     }
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
   if(t.ValueKind!=JsonValueKind.Object)continue;
   if(t.TryGetProperty("status",out var status)&&status.ValueKind==JsonValueKind.String&&status.GetString()=="done")continue;
   if(t.TryGetProperty("reminderDismissed",out var dismissed)&&dismissed.ValueKind==JsonValueKind.True&&Text(t,"reminderDelivery","")!="local")continue;
   var raw = AlarmTime(t, false);
   if (string.IsNullOrEmpty(raw)) continue;
   if (!DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out var localTime)) continue;
   if (!t.TryGetProperty("id", out var idEl)) continue;
   var id = idEl.ToString();
   var title = Text(t,"title","Task");
   var important = t.TryGetProperty("important", out var impEl) && impEl.ValueKind == JsonValueKind.True;
   var utc = TriggerUtc(t,localTime,tzOffsetMinutes);
   var age = now - utc;
   if (utc <= now && age < TimeSpan.FromMinutes(5)) due.Add(("task", ReminderKey(id,utc), "Reminder: " + title, $"Task \"{title}\" is due!", important));
  }
 }
 static void CollectDueEventReminders(List<Domain.UserDataEntry> entries, DateTimeOffset now, int tzOffsetMinutes, List<(string, string, string, string, bool)> due) {
  var json = entries.FirstOrDefault(x => x.Key.StartsWith("taskflow_events_", StringComparison.Ordinal))?.ValueJson;
  if (json is null) return;
  List<JsonElement>? events;
  try { events = JsonSerializer.Deserialize<List<JsonElement>>(json); } catch { return; }
  if (events is null) return;
  foreach (var ev in events) {
   if(ev.ValueKind!=JsonValueKind.Object)continue;
   if(ev.TryGetProperty("reminderFired",out var fired)&&fired.ValueKind==JsonValueKind.True&&Text(ev,"reminderDelivery","")!="local")continue;
   if (!ev.TryGetProperty("remindBefore", out var rbEl) || rbEl.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) continue;
   if (!ev.TryGetProperty("date", out var dateEl)) continue;
   var date = dateEl.ValueKind==JsonValueKind.String?dateEl.GetString():null; if (string.IsNullOrEmpty(date)) continue;
   var time = Text(ev,"time","00:00");
   if (string.IsNullOrEmpty(time)) time = "00:00";
   if (!DateTime.TryParse($"{date}T{time}:00", CultureInfo.InvariantCulture, DateTimeStyles.None, out var localEventTime)) continue;
   if (!ev.TryGetProperty("id", out var idEl)) continue;
   var id = idEl.ToString();
   var title = Text(ev,"title","Event");
   var important = ev.TryGetProperty("important", out var impEl) && impEl.ValueKind == JsonValueKind.True;
   var remindBefore = rbEl.ValueKind == JsonValueKind.Number ? rbEl.GetDouble() : 0;
   var triggerUtc = TriggerUtc(ev,localEventTime.AddMinutes(-remindBefore),tzOffsetMinutes);
   var age = now - triggerUtc;
   if (triggerUtc <= now && age < TimeSpan.FromMinutes(5)) due.Add(("event", ReminderKey(id,triggerUtc), title, "Coming up now", important));
  }
 }
 static void CollectDueTimetableBlockReminders(List<Domain.UserDataEntry> entries, DateTimeOffset now, int tzOffsetMinutes, List<(string, string, string, string, bool)> due) {
  var json = entries.FirstOrDefault(x => x.Key.StartsWith("taskflow_timetable_blocks_", StringComparison.Ordinal))?.ValueJson;
  if (json is null) return;
  List<JsonElement>? blocks;
  try { blocks = JsonSerializer.Deserialize<List<JsonElement>>(json); } catch { return; }
  if (blocks is null) return;
  foreach (var block in blocks) {
   if(block.ValueKind!=JsonValueKind.Object)continue;
   var raw = AlarmTime(block, true);
   if (string.IsNullOrEmpty(raw)) continue;
   if (block.TryGetProperty("completedAt", out var completedEl) && completedEl.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined) continue;
   if (block.TryGetProperty("reminderDismissed", out var dismissedEl) && dismissedEl.ValueKind == JsonValueKind.True&&Text(block,"reminderDelivery","")!="local") continue;
   if (!DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out var localTime)) continue;
   if (!block.TryGetProperty("id", out var idEl)) continue;
   var id = idEl.ToString();
   var title = Text(block,"title","Time block");
   var important = block.TryGetProperty("important", out var impEl) && impEl.ValueKind == JsonValueKind.True;
   var utc = TriggerUtc(block,localTime,tzOffsetMinutes);
   var age = now - utc;
   if (utc <= now && age < TimeSpan.FromMinutes(5)) due.Add(("timetable", ReminderKey(id,utc), "Reminder: " + title, "Time block is starting!", important));
  }
 }
 static string AlarmTime(JsonElement item, bool block) {
  var custom=Text(item,"reminder","");
  if(custom.Length>0)return custom;
  if(!item.TryGetProperty("important",out var important)||important.ValueKind!=JsonValueKind.True)return "";
  if(!block){var date=Text(item,"due","");var time=Text(item,"due_time","");return date.Length>0&&time.Length>0?date+"T"+time:"";}
  var day=Text(item,"date","");
  if(day.Length==0||!item.TryGetProperty("start",out var start)||start.ValueKind!=JsonValueKind.Number||!start.TryGetInt32(out var minutes)||minutes<0||minutes>=1440)return "";
  return day+"T"+(minutes/60).ToString("D2")+":"+(minutes%60).ToString("D2");
 }
 static string Text(JsonElement item,string name,string fallback)=>item.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.String?value.GetString()??fallback:fallback;
 static string ReminderKey(string id,DateTimeOffset at)=>Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(id+"|"+at.ToUnixTimeMilliseconds())));
 static DateTimeOffset TriggerUtc(JsonElement item,DateTime fallback,int offset){
  if(item.TryGetProperty("reminderUtc",out var value)&&value.ValueKind==JsonValueKind.String&&DateTimeOffset.TryParse(value.GetString(),CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal,out var utc))return utc;
  return LocalToUtc(fallback,offset);
 }
 static DateTimeOffset LocalToUtc(DateTime naiveLocal, int tzOffsetMinutes) => new DateTimeOffset(DateTime.SpecifyKind(naiveLocal, DateTimeKind.Unspecified), TimeSpan.Zero).AddMinutes(tzOffsetMinutes);
}

public interface IReminderPushSender {
 Task SendAsync(WebPush.PushSubscription subscription,string payload,VapidDetails vapid,CancellationToken ct);
}
public sealed class ReminderPushSender : IReminderPushSender {
 public Task SendAsync(WebPush.PushSubscription subscription,string payload,VapidDetails vapid,CancellationToken ct)
  => new WebPushClient().SendNotificationAsync(subscription,payload,vapid,cancellationToken:ct);
}
