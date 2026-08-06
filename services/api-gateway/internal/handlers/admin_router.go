package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/adminauth"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/broker"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

const adminCORSMaximumAgeSeconds = 300

// newAdminRouter builds the /api/admin sub-router with its own middleware
// stack - a distinct CORS handler (exactly one origin, credentialed so the
// session cookies travel), its own rate limit bucket, and default-deny by
// construction: every route below requires either nothing (login, invite
// accept), a presented refresh cookie (refresh, logout), or a verified
// access token plus one specific permission (every record/management
// route). See notes/vision/auth-and-admin-plan.md#amended--one-gateway-two-route-groups.
func newAdminRouter(serviceConfig config.Config, brokerClient broker.Client, edgeStore EdgeStore, transport *RPCTransport) http.Handler {
	adminRouter := chi.NewRouter()
	adminRouter.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{serviceConfig.AdminAllowedOrigin},
		AllowedMethods:   []string{http.MethodGet, http.MethodPost, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowedHeaders:   []string{"Accept", "Content-Type", "X-Request-Id"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: true,
		MaxAge:           adminCORSMaximumAgeSeconds,
	}))
	adminRouter.Use(middleware.RateLimit(edgeStore, adminRateLimitRouteKey, serviceConfig.AdminRateLimitRequestsPerSecond, serviceConfig.AdminRateLimitBurst))
	adminRouter.Use(middleware.BodyLimit(serviceConfig.MaximumRequestBodyBytes))

	authHandler := NewAdminAuthHandler(serviceConfig, transport)
	adminRouter.Post("/auth/login", authHandler.Login)
	adminRouter.Post("/auth/invite/accept", authHandler.AcceptInvite)
	adminRouter.With(middleware.RequireAdminRefreshCookie).Post("/auth/refresh", authHandler.Refresh)
	adminRouter.With(middleware.RequireAdminRefreshCookie).Post("/auth/logout", authHandler.Logout)

	requireAccessToken := middleware.RequireAdminAccessToken(
		adminauth.NewTokenVerifier(serviceConfig.AdminAccessPublicKeys),
		adminauth.NewRevocationChecker(edgeStore, brokerClient, serviceConfig.NATSRequestTimeout, serviceConfig.AdminTokenVersionCacheTTL),
	)
	requirePermission := func(code contracts.PermissionCode) func(http.Handler) http.Handler {
		return middleware.RequireAdminPermission(transport, code)
	}

	accountsHandler := NewAdminAccountsHandler(transport)
	rolesHandler := NewAdminRolesHandler(transport)
	permissionsHandler := NewAdminPermissionsHandler(transport)
	auditHandler := NewAdminAuditHandler(transport)

	adminRouter.Group(func(managementRouter chi.Router) {
		managementRouter.Use(requireAccessToken)

		managementRouter.With(requirePermission(contracts.PermissionAccountRead)).Get("/accounts", accountsHandler.List)
		managementRouter.With(requirePermission(contracts.PermissionAccountRead)).Get("/accounts/{accountID}", accountsHandler.Get)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Post("/accounts/invite", accountsHandler.Invite)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Post("/accounts/{accountID}/disable", accountsHandler.Disable)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Post("/accounts/{accountID}/enable", accountsHandler.Enable)

		managementRouter.With(requirePermission(contracts.PermissionRoleRead)).Get("/roles", rolesHandler.List)
		managementRouter.With(requirePermission(contracts.PermissionRoleManage)).Post("/roles", rolesHandler.Create)
		managementRouter.With(requirePermission(contracts.PermissionRoleManage)).Patch("/roles/{roleID}", rolesHandler.Update)
		managementRouter.With(requirePermission(contracts.PermissionRoleManage)).Delete("/roles/{roleID}", rolesHandler.Delete)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Post("/roles/assign", rolesHandler.Assign)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Post("/roles/revoke", rolesHandler.Revoke)

		managementRouter.With(requirePermission(contracts.PermissionRoleRead)).Get("/permissions", permissionsHandler.List)
		managementRouter.With(requirePermission(contracts.PermissionAuditRead)).Get("/audit", auditHandler.List)
	})

	adminRouter.NotFound(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "ROUTE_NOT_FOUND", "The requested gateway route was not found.")
	})
	adminRouter.MethodNotAllowed(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "The request method is not allowed for this route.")
	})
	return adminRouter
}
