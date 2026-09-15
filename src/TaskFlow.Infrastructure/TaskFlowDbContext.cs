using Microsoft.EntityFrameworkCore;
using TaskFlow.Domain;
namespace TaskFlow.Infrastructure;
public sealed class TaskFlowDbContext(DbContextOptions<TaskFlowDbContext> options) : DbContext(options) {
 public DbSet<User> Users => Set<User>(); public DbSet<Organization> Organizations => Set<Organization>(); public DbSet<OrganizationMember> Members => Set<OrganizationMember>(); public DbSet<Project> Projects => Set<Project>(); public DbSet<TaskItem> Tasks => Set<TaskItem>(); public DbSet<RefreshSession> RefreshSessions => Set<RefreshSession>();
 public DbSet<Subtask> Subtasks => Set<Subtask>(); public DbSet<TaskComment> TaskComments => Set<TaskComment>(); public DbSet<Tag> Tags => Set<Tag>(); public DbSet<TaskTag> TaskTags => Set<TaskTag>();
 protected override void OnModelCreating(ModelBuilder b) {
  b.Entity<User>(e=>{e.HasIndex(x=>x.Email).IsUnique();e.Property(x=>x.Email).HasMaxLength(320);});
  b.Entity<OrganizationMember>().HasKey(x=>new{x.OrganizationId,x.UserId});
  b.Entity<Project>(e=>{e.HasIndex(x=>new{x.OrganizationId,x.Name});e.Property(x=>x.Name).HasMaxLength(200);});
  b.Entity<TaskItem>(e=>{e.HasIndex(x=>new{x.OrganizationId,x.UpdatedAt});e.HasIndex(x=>new{x.OrganizationId,x.ProjectId});e.Property(x=>x.Version).IsRowVersion();e.Property(x=>x.Title).HasMaxLength(200);});
  b.Entity<RefreshSession>().HasIndex(x=>x.TokenHash).IsUnique();
  b.Entity<Subtask>(e=>{e.HasIndex(x=>new{x.OrganizationId,x.TaskId});e.Property(x=>x.Title).HasMaxLength(200);});
  b.Entity<TaskComment>(e=>{e.HasIndex(x=>new{x.OrganizationId,x.TaskId,x.CreatedAt});e.Property(x=>x.Body).HasMaxLength(4000);});
  b.Entity<Tag>(e=>{e.HasIndex(x=>new{x.OrganizationId,x.Name}).IsUnique();e.Property(x=>x.Name).HasMaxLength(60);});
  b.Entity<TaskTag>(e=>{e.HasKey(x=>new{x.TaskId,x.TagId});e.HasIndex(x=>new{x.OrganizationId,x.TagId});});
 }
}
