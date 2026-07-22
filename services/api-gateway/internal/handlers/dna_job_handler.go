package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/rs/zerolog/log"
)

const activeJobCacheTTL = time.Second

type DNAJobHandler struct {
	transport                *RPCTransport
	completedCacheTimeToLive time.Duration
}

func NewDNAJobHandler(serviceConfig config.Config, transport *RPCTransport) *DNAJobHandler {
	return &DNAJobHandler{transport: transport, completedCacheTimeToLive: serviceConfig.JobCacheTimeToLive}
}

func (handler *DNAJobHandler) GetJob(responseWriter http.ResponseWriter, request *http.Request) {
	jobID := chi.URLParam(request, "jobID")
	if handler.transport.WriteCacheHit(responseWriter, request, jobCacheNamespace, jobID) {
		return
	}
	response, ok := handler.transport.Request(responseWriter, request, contracts.DNAJobGetQuerySubject, contracts.JobQueryData{JobID: jobID})
	if !ok {
		return
	}
	var job contracts.Job
	if err := json.Unmarshal(response.Data.Payload, &job); err != nil || job.JobID != jobID {
		httpx.WriteError(responseWriter, request, http.StatusBadGateway, "INVALID_SERVICE_RESPONSE", "The service returned an invalid job response.")
		return
	}
	cacheTimeToLive := handler.completedCacheTimeToLive
	if job.Status == contracts.JobStatusQueued || job.Status == contracts.JobStatusProcessing {
		cacheTimeToLive = activeJobCacheTTL
	}
	if err := handler.transport.StoreCache(request.Context(), jobCacheNamespace, jobID, response.Data.Payload, cacheTimeToLive); err != nil {
		log.Warn().Err(err).Str("job_id", jobID).Msg("cache job response")
	}
	responseWriter.Header().Set("X-Cache", "MISS")
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}
