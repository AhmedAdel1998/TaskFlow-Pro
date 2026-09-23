FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY src/TaskFlow.Domain/TaskFlow.Domain.csproj TaskFlow.Domain/
COPY src/TaskFlow.Application/TaskFlow.Application.csproj TaskFlow.Application/
COPY src/TaskFlow.Infrastructure/TaskFlow.Infrastructure.csproj TaskFlow.Infrastructure/
COPY src/TaskFlow.Api/TaskFlow.Api.csproj TaskFlow.Api/
RUN dotnet restore TaskFlow.Api/TaskFlow.Api.csproj
COPY src/TaskFlow.Domain/ TaskFlow.Domain/
COPY src/TaskFlow.Application/ TaskFlow.Application/
COPY src/TaskFlow.Infrastructure/ TaskFlow.Infrastructure/
COPY src/TaskFlow.Api/ TaskFlow.Api/
RUN dotnet publish TaskFlow.Api/TaskFlow.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080
ENTRYPOINT ["dotnet", "TaskFlow.Api.dll"]
