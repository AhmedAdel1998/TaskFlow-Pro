using TaskFlow.Domain;
namespace TaskFlow.Application;
public record RegisterCommand(string Email, string Password, string OrganizationName);
public record LoginCommand(string Email, string Password);
public record AuthResult(string AccessToken, string RefreshToken, DateTimeOffset ExpiresAt, Guid OrganizationId);
public record CreateTaskCommand(string Title, string? Description, Guid? ProjectId, Guid? AssigneeId, string Priority, DateTimeOffset? DueAt);
public record UpdateTaskCommand(string Title, string? Description, TaskState Status, string Priority, DateTimeOffset? DueAt, uint Version);
public record TaskDto(Guid Id, string Title, string? Description, TaskState Status, string Priority, Guid? ProjectId, Guid? AssigneeId, DateTimeOffset? DueAt, uint Version);
public record CreateProjectCommand(string Name, string? Description);
public record ProjectDto(Guid Id, string Name, string? Description, DateTimeOffset CreatedAt);
public record CreateSubtaskCommand(string Title);
public record SubtaskDto(Guid Id, Guid TaskId, string Title, bool IsDone, int SortOrder);
public record UpdateSubtaskCommand(string Title, bool IsDone);
public record CreateCommentCommand(string Body);
public record CommentDto(Guid Id, Guid TaskId, Guid AuthorId, string Body, DateTimeOffset CreatedAt);
public record CreateTagCommand(string Name);
public record TagDto(Guid Id, string Name);
public interface IAuthService { Task<AuthResult> RegisterAsync(RegisterCommand command, CancellationToken ct); Task<AuthResult?> LoginAsync(LoginCommand command, CancellationToken ct); Task<AuthResult?> RefreshAsync(string refreshToken, CancellationToken ct); }
public interface ITaskService { Task<IReadOnlyList<TaskDto>> ListAsync(Guid userId, Guid organizationId, CancellationToken ct); Task<TaskDto> CreateAsync(Guid userId, Guid organizationId, CreateTaskCommand command, CancellationToken ct); Task<TaskDto?> UpdateAsync(Guid userId, Guid organizationId, Guid id, UpdateTaskCommand command, CancellationToken ct); }
public interface IProjectService { Task<IReadOnlyList<ProjectDto>> ListAsync(Guid userId, Guid organizationId, CancellationToken ct); Task<ProjectDto> CreateAsync(Guid userId, Guid organizationId, CreateProjectCommand command, CancellationToken ct); }
public interface ISubtaskService { Task<IReadOnlyList<SubtaskDto>> ListAsync(Guid userId, Guid organizationId, Guid taskId, CancellationToken ct); Task<SubtaskDto> CreateAsync(Guid userId, Guid organizationId, Guid taskId, CreateSubtaskCommand command, CancellationToken ct); Task<SubtaskDto?> UpdateAsync(Guid userId, Guid organizationId, Guid taskId, Guid id, UpdateSubtaskCommand command, CancellationToken ct); }
public interface ICommentService { Task<IReadOnlyList<CommentDto>> ListAsync(Guid userId, Guid organizationId, Guid taskId, CancellationToken ct); Task<CommentDto> CreateAsync(Guid userId, Guid organizationId, Guid taskId, CreateCommentCommand command, CancellationToken ct); }
public interface ITagService { Task<IReadOnlyList<TagDto>> ListAsync(Guid userId, Guid organizationId, CancellationToken ct); Task<TagDto> CreateAsync(Guid userId, Guid organizationId, CreateTagCommand command, CancellationToken ct); }
