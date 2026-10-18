# The isolated test base already contains the unchanged dependencies and engines.
# Use apps/api/Dockerfile for a full rebuild or when those dependencies change.
FROM lingke-autofill-test:cookie-guide-20261018
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
COPY apps/api/src/modules/applications/service.js /app/apps/api/src/modules/applications/service.js
COPY apps/api/src/profile/service.js /app/apps/api/src/profile/service.js
