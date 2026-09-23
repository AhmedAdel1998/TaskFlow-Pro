using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using TaskFlow.Domain;
namespace TaskFlow.Infrastructure;
/* SQLite has no native DateTimeOffset ordering/comparison support in EF Core; store as Unix milliseconds so
   ORDER BY / range comparisons (e.g. RefreshSession.ExpiresAt > now) translate to plain integer operations. */
public sealed class DateTimeOffsetToUnixMsConverter() : ValueConverter<DateTimeOffset, long>(v => v.ToUnixTimeMilliseconds(), v => DateTimeOffset.FromUnixTimeMilliseconds(v));
public sealed class NullableDateTimeOffsetToUnixMsConverter() : ValueConverter<DateTimeOffset?, long?>(v => v.HasValue ? v.Value.ToUnixTimeMilliseconds() : (long?)null, v => v.HasValue ? DateTimeOffset.FromUnixTimeMilliseconds(v.Value) : (DateTimeOffset?)null);
public sealed class TaskFlowDbContext(DbContextOptions<TaskFlowDbContext> options) : DbContext(options) {
 public DbSet<User> Users => Set<User>(); public DbSet<Organization> Organizations => Set<Organization>(); public DbSet<OrganizationMember> Members => Set<OrganizationMember>(); public DbSet<Project> Projects => Set<Project>(); public DbSet<TaskItem> Tasks => Set<TaskItem>(); public DbSet<RefreshSession> RefreshSessions => Set<RefreshSession>();
 public DbSet<Subtask> Subtasks => Set<Subtask>(); public DbSet<TaskComment> TaskComments => Set<TaskComment>(); public DbSet<Tag> Tags => Set<Tag>(); public DbSet<TaskTag> TaskTags => Set<TaskTag>(); public DbSet<UserDataEntry> UserData => Set<UserDataEntry>();
 protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder) {
  configurationBuilder.Properties<DateTimeOffset>().HaveConversion<DateTimeOffsetToUnixMsConverter>();
  configurationBuilder.Properties<DateTimeOffset?>().HaveConversion<NullableDateTimeOffsetToUnixMsConverter>();
 }
 protected override void OnModelCreating(ModelBuilder b) {
  b.Entity<User>(e=>{e.HasIndex(x=>x.Email).IsUnique();e.Property(x=>x.Email).HasMaxLength(320);});
  b.Entity<OrganizationMember>().HasKey(x=>new{x.OrganizationId,x.UserId});
  b.Entity<Project>(e=>{e.HasIndex(x=>new{x.OrganizationId,x.Name});e.Property(x=>x.Name).HasMaxLength(200);});
  b.Entity<TaskItem>(e=>{e.HasIndex(x=>new{x.OrganizationId,x.UpdatedAt});e.HasIndex(x=>new{x.OrganizationId,x.ProjectId});e.Property(x=>x.Version).IsConcurrencyToken();e.Property(x=>x.Title).HasMaxLength(200);});
  b.Entity<RefreshSession>().HasIndex(x=>x.TokenHash).IsUnique();
  b.Entity<Subtask>(e=>{e.HasIndex(x=>new{x.OrganizationId,x.TaskId});e.Property(x=>x.Title).HasMaxLength(200);});
  b.Entity<TaskComment>(e=>{e.HasIndex(x=>new{x.OrganizationId,x.TaskId,x.CreatedAt});e.Property(x=>x.Body).HasMaxLength(4000);});
  b.Entity<Tag>(e=>{e.HasIndex(x=>new{x.OrganizationId,x.Name}).IsUnique();e.Property(x=>x.Name).HasMaxLength(60);});
  b.Entity<TaskTag>(e=>{e.HasKey(x=>new{x.TaskId,x.TagId});e.HasIndex(x=>new{x.OrganizationId,x.TagId});});
  b.Entity<UserDataEntry>(e=>{e.HasIndex(x=>new{x.UserId,x.Key}).IsUnique();e.Property(x=>x.Key).HasMaxLength(200);});
 }
}
