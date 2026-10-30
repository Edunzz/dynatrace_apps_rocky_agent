# syntax=docker/dockerfile:1.7
#
# Rocky Agent runtime: Claude Code (headless, driven by the Rocky gateway) +
# dtctl + Dynatrace skills. Every external input is pinned (image digest,
# versions, checksums, commit SHAs). No secret is accepted as a build argument.

ARG NODE_IMAGE=node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

# ---------------------------------------------------------------------------
# Stage 1: fetch and verify pinned artifacts
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS fetch

ARG TARGETARCH
ARG DTCTL_VERSION=0.45.0
ARG DTCTL_SHA256_AMD64=eb705db005cc8c79e75d919190d70863204ac66b403263e34e93a79038464085
ARG DTCTL_SHA256_ARM64=6ecf503ce27f98d9a6f08e75a3eef24a024c6f2f073b820cb8ba5684a680ae30
ARG CLAUDE_CODE_VERSION=2.1.308
ARG CLAUDE_CODE_SHA256_AMD64=356733f185fa988e6bf3aa9a555269fdd167982a2e2a80d3c8a78037bb92ad58
ARG CLAUDE_CODE_SHA256_ARM64=fdd22e6cbb734d580f5664c48df4294eeec850218ff07f186f9af30426396ee1
ARG DT_SKILLS_REPO=https://github.com/Dynatrace/dynatrace-for-ai.git
ARG DT_SKILLS_REF=f1abd8dae1f067e485bbd508a1ebe6003f9fc624
ARG RCA_SKILLS_REPO=https://github.com/Edunzz/dynatrace_ai_skills_rca.git
ARG RCA_SKILLS_REF=02a6a1483f8ecca2fe19415a1188bf46bcf727e6
ARG INSTALL_DRAWIO_DESKTOP=true
ARG DRAWIO_VERSION=32.6.1
ARG DRAWIO_SHA256_AMD64=515a975fbdb982e0d736b6f99248dbbb856a8b07bb72d6d3648a54b850fa33db
ARG DRAWIO_SHA256_ARM64=eb3354233d55e27624c2e8361680572fdb9528cfc5728d1d44bb7764306b4f61

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gpg gpgv jq \
 && rm -rf /var/lib/apt/lists/*

COPY scripts/install-dtctl.sh scripts/install-claude-code.sh scripts/install-skills.sh scripts/install-drawio.sh /build/scripts/
COPY skills/drawio /build/skills/drawio

RUN DTCTL_VERSION="$DTCTL_VERSION" TARGETARCH="$TARGETARCH" \
    DTCTL_SHA256_AMD64="$DTCTL_SHA256_AMD64" DTCTL_SHA256_ARM64="$DTCTL_SHA256_ARM64" \
    /build/scripts/install-dtctl.sh /out/bin

RUN CLAUDE_CODE_VERSION="$CLAUDE_CODE_VERSION" TARGETARCH="$TARGETARCH" \
    CLAUDE_CODE_SHA256_AMD64="$CLAUDE_CODE_SHA256_AMD64" CLAUDE_CODE_SHA256_ARM64="$CLAUDE_CODE_SHA256_ARM64" \
    /build/scripts/install-claude-code.sh /out/bin

RUN DT_SKILLS_REPO="$DT_SKILLS_REPO" DT_SKILLS_REF="$DT_SKILLS_REF" \
    RCA_SKILLS_REPO="$RCA_SKILLS_REPO" RCA_SKILLS_REF="$RCA_SKILLS_REF" \
    DRAWIO_SKILL_DIR=/build/skills/drawio \
    /build/scripts/install-skills.sh /out/skills /out/skills-manifest.json

RUN mkdir -p /out/drawio \
 && if [ "$INSTALL_DRAWIO_DESKTOP" = "true" ]; then \
      DRAWIO_VERSION="$DRAWIO_VERSION" TARGETARCH="$TARGETARCH" \
      DRAWIO_SHA256_AMD64="$DRAWIO_SHA256_AMD64" DRAWIO_SHA256_ARM64="$DRAWIO_SHA256_ARM64" \
      /build/scripts/install-drawio.sh /out/drawio; \
    fi

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

ARG INSTALL_DRAWIO_DESKTOP=true
ARG ROCKY_VERSION=0.1.0

LABEL org.opencontainers.image.title="Rocky Agent runtime" \
      org.opencontainers.image.description="Claude Code runtime with Dynatrace skills, dtctl and a hardened gateway" \
      org.opencontainers.image.source="https://github.com/Edunzz/dynatrace_apps_rocky_agent" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${ROCKY_VERSION}"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Base tools. Python 3 is required by the custom RCA skill scripts, which call
# it as `python`.
# The X/GTK libraries are only installed for the headless draw.io exporter.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash bubblewrap ca-certificates curl git jq unzip openssh-client python3 python-is-python3 ripgrep tini \
 && if [ "$INSTALL_DRAWIO_DESKTOP" = "true" ]; then \
      apt-get install -y --no-install-recommends \
        xvfb xauth libgtk-3-0 libnss3 libxss1 libasound2 libgbm1 libnotify4 libxtst6 \
        libsecret-1-0 libatspi2.0-0 libuuid1 libdrm2 libxkbcommon0 libxcomposite1 \
        libxdamage1 libxrandr2 libcups2 xdg-utils fonts-dejavu-core fonts-liberation; \
    fi \
 && rm -rf /var/lib/apt/lists/*

COPY --from=fetch /out/bin/dtctl /out/bin/claude /usr/local/bin/
COPY --from=fetch /out/skills /opt/rocky/skills
COPY --from=fetch /out/skills-manifest.json /opt/rocky/skills-manifest.json
COPY --from=fetch /out/drawio/ /

# Managed settings: permission rules no user, project or command-line setting
# can override (root-owned, read-only image).
COPY claude/managed-settings.json /etc/claude-code/managed-settings.json
COPY AGENTS.md /opt/rocky/policy/AGENTS.md
COPY src/gateway/ /opt/rocky/gateway/
COPY scripts/ /opt/rocky/scripts/
COPY entrypoint.sh healthcheck.sh /opt/rocky/

# /home/rocky/.claude (Claude Code login, transcripts, skills) and
# /home/rocky/.rocky (sessions) exist with the right owner so a volume mounted
# on /home/rocky starts out usable.
RUN useradd --uid 10001 --user-group --create-home --home-dir /home/rocky --shell /bin/bash rocky \
 && mkdir -p /workspace /home/rocky/.claude /home/rocky/.rocky \
 && chown 10001:10001 /workspace /home/rocky/.claude /home/rocky/.rocky \
 && chmod 0644 /etc/claude-code/managed-settings.json \
 && chmod 0755 /opt/rocky/entrypoint.sh /opt/rocky/healthcheck.sh /opt/rocky/scripts/*.sh \
 && chmod -R a-w /opt/rocky \
 && dtctl version \
 && DISABLE_AUTOUPDATER=1 claude --version \
 && if [ "$INSTALL_DRAWIO_DESKTOP" = "true" ]; then test -x /usr/local/bin/drawio; fi

# DTCTL_TOKEN_STORAGE selects file-based storage; it holds no secret value.
# hadolint ignore=DL3064
ENV NODE_ENV=production \
    HOME=/home/rocky \
    WORKSPACE_PATH=/workspace \
    ROCKY_PORT=4096 \
    ROCKY_SERVER_USERNAME=rocky \
    LOG_LEVEL=info \
    ROCKY_VERSION=${ROCKY_VERSION} \
    ROCKY_STATE_DIR=/tmp/rocky \
    ROCKY_DATA_DIR=/home/rocky/.rocky \
    CLAUDE_CONFIG_DIR=/home/rocky/.claude \
    DISABLE_AUTOUPDATER=1 \
    DTCTL_DISABLE_KEYRING=1 \
    DTCTL_TOKEN_STORAGE=file

USER 10001:10001
WORKDIR /workspace
EXPOSE 4096

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 CMD ["/opt/rocky/healthcheck.sh"]
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/rocky/entrypoint.sh"]
