using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using TaskFlow.Application;
using TaskFlow.Infrastructure;
var builder=WebApplication.CreateBuilder(args);
var port=Environment.GetEnvironmentVariable("PORT"); if(!string.IsNullOrEmpty(port)) builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
var cs=builder.Configuration.GetConnectionString("TaskFlow")??throw new InvalidOperationException("ConnectionStrings:TaskFlow is required."); var key=builder.Configuration["Jwt:Key"]??throw new InvalidOperationException("Jwt:Key is required.");
builder.Services.AddDbContext<TaskFlowDbContext>(o=>o.UseSqlite(cs));
builder.Services.AddScoped<IAuthService,AuthService>();
builder.Services.AddScoped<ITaskService,TaskService>();
builder.Services.AddScoped<IProjectService,ProjectService>();
builder.Services.AddScoped<ISubtaskService,SubtaskService>();
builder.Services.AddScoped<ICommentService,CommentService>();
builder.Services.AddScoped<ITagService,TagService>();
builder.Services.AddScoped<IUserDataService,UserDataService>();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o=>{o.MapInboundClaims=false;o.TokenValidationParameters=new(){ValidateIssuerSigningKey=true,IssuerSigningKey=new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),ValidateIssuer=false,ValidateAudience=false,ValidateLifetime=true};}); builder.Services.AddAuthorization(); var authRateLimit=builder.Configuration.GetValue<int?>("RateLimits:Auth")??10; builder.Services.AddRateLimiter(o=>{o.RejectionStatusCode=429;o.AddFixedWindowLimiter("auth",x=>{x.PermitLimit=authRateLimit;x.Window=TimeSpan.FromMinutes(1);x.QueueLimit=0;});});
builder.Services.AddCors(o=>o.AddDefaultPolicy(p=>p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
var app=builder.Build();
using(var scope=app.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>();db.Database.Migrate();db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL;");}
/* No app-level HTTPS redirect: Railway (and most PaaS hosts) terminate TLS at their edge and forward
   plain HTTP to the container, so redirecting here would either be redundant or loop. */
app.UseCors();app.UseRateLimiter();app.UseAuthentication();app.UseAuthorization();
app.Use(async(c,n)=>{c.Response.Headers.Append("X-Content-Type-Options","nosniff");c.Response.Headers.Append("Referrer-Policy","no-referrer");await n();});
app.Use(async(c,n)=>{
 try{await n();}
 catch(UnauthorizedAccessException){c.Response.StatusCode=403;await c.Response.WriteAsJsonAsync(new{error="forbidden"});}
 catch(KeyNotFoundException){c.Response.StatusCode=404;await c.Response.WriteAsJsonAsync(new{error="not_found"});}
 catch(DbUpdateConcurrencyException){c.Response.StatusCode=409;await c.Response.WriteAsJsonAsync(new{error="conflict"});}
 catch(ArgumentException ex){c.Response.StatusCode=400;await c.Response.WriteAsJsonAsync(new{error=ex.Message});}
 catch(InvalidOperationException ex){c.Response.StatusCode=400;await c.Response.WriteAsJsonAsync(new{error=ex.Message});}
});
app.MapGet("/health/live",()=>Results.Ok(new{status="live"})); app.MapGet("/health/ready",async(TaskFlowDbContext db,CancellationToken ct)=>await db.Database.CanConnectAsync(ct)?Results.Ok(new{status="ready"}):Results.StatusCode(503));
app.MapPost("/api/auth/register",async(RegisterCommand x,IAuthService s,CancellationToken ct)=>Results.Ok(await s.RegisterAsync(x,ct))).RequireRateLimiting("auth");
app.MapPost("/api/auth/login",async(LoginCommand x,IAuthService s,CancellationToken ct)=>{var r=await s.LoginAsync(x,ct);return r is null?Results.Unauthorized():Results.Ok(r);}).RequireRateLimiting("auth");
app.MapPost("/api/auth/refresh",async(RefreshRequest x,IAuthService s,CancellationToken ct)=>{var r=await s.RefreshAsync(x.RefreshToken,ct);return r is null?Results.Unauthorized():Results.Ok(r);}).RequireRateLimiting("auth");
app.MapGet("/api/tasks",async(ClaimsPrincipal p,ITaskService s,CancellationToken ct)=>Results.Ok(await s.ListAsync(User(p),Org(p),ct))).RequireAuthorization();
app.MapPost("/api/tasks",async(ClaimsPrincipal p,CreateTaskCommand x,ITaskService s,CancellationToken ct)=>Results.Ok(await s.CreateAsync(User(p),Org(p),x,ct))).RequireAuthorization();
app.MapPut("/api/tasks/{id:guid}",async(Guid id,ClaimsPrincipal p,UpdateTaskCommand x,ITaskService s,CancellationToken ct)=>{var r=await s.UpdateAsync(User(p),Org(p),id,x,ct);return r is null?Results.NotFound():Results.Ok(r);}).RequireAuthorization();
app.MapGet("/api/projects",async(ClaimsPrincipal p,IProjectService s,CancellationToken ct)=>Results.Ok(await s.ListAsync(User(p),Org(p),ct))).RequireAuthorization();
app.MapPost("/api/projects",async(ClaimsPrincipal p,CreateProjectCommand x,IProjectService s,CancellationToken ct)=>Results.Ok(await s.CreateAsync(User(p),Org(p),x,ct))).RequireAuthorization();
app.MapGet("/api/tasks/{taskId:guid}/subtasks",async(Guid taskId,ClaimsPrincipal p,ISubtaskService s,CancellationToken ct)=>Results.Ok(await s.ListAsync(User(p),Org(p),taskId,ct))).RequireAuthorization();
app.MapPost("/api/tasks/{taskId:guid}/subtasks",async(Guid taskId,ClaimsPrincipal p,CreateSubtaskCommand x,ISubtaskService s,CancellationToken ct)=>Results.Ok(await s.CreateAsync(User(p),Org(p),taskId,x,ct))).RequireAuthorization();
app.MapPut("/api/tasks/{taskId:guid}/subtasks/{id:guid}",async(Guid taskId,Guid id,ClaimsPrincipal p,UpdateSubtaskCommand x,ISubtaskService s,CancellationToken ct)=>{var r=await s.UpdateAsync(User(p),Org(p),taskId,id,x,ct);return r is null?Results.NotFound():Results.Ok(r);}).RequireAuthorization();
app.MapGet("/api/tasks/{taskId:guid}/comments",async(Guid taskId,ClaimsPrincipal p,ICommentService s,CancellationToken ct)=>Results.Ok(await s.ListAsync(User(p),Org(p),taskId,ct))).RequireAuthorization();
app.MapPost("/api/tasks/{taskId:guid}/comments",async(Guid taskId,ClaimsPrincipal p,CreateCommentCommand x,ICommentService s,CancellationToken ct)=>Results.Ok(await s.CreateAsync(User(p),Org(p),taskId,x,ct))).RequireAuthorization();
app.MapGet("/api/tags",async(ClaimsPrincipal p,ITagService s,CancellationToken ct)=>Results.Ok(await s.ListAsync(User(p),Org(p),ct))).RequireAuthorization();
app.MapPost("/api/tags",async(ClaimsPrincipal p,CreateTagCommand x,ITagService s,CancellationToken ct)=>Results.Ok(await s.CreateAsync(User(p),Org(p),x,ct))).RequireAuthorization();
app.MapGet("/api/data",async(ClaimsPrincipal p,IUserDataService s,CancellationToken ct)=>Results.Ok(await s.ListAsync(User(p),ct))).RequireAuthorization();
app.MapPut("/api/data/{key}",async(string key,ClaimsPrincipal p,UpsertDataCommand x,IUserDataService s,CancellationToken ct)=>Results.Ok(await s.UpsertAsync(User(p),key,x,ct))).RequireAuthorization();
app.MapDelete("/api/data/{key}",async(string key,ClaimsPrincipal p,IUserDataService s,CancellationToken ct)=>{await s.DeleteAsync(User(p),key,ct);return Results.NoContent();}).RequireAuthorization();
app.Run();
static Guid User(ClaimsPrincipal p)=>Guid.Parse(p.FindFirst("sub")!.Value); static Guid Org(ClaimsPrincipal p)=>Guid.Parse(p.FindFirst("org")!.Value); public record RefreshRequest(string RefreshToken);
public partial class Program;
