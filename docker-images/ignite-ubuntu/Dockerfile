FROM weaveworks/ignite-ubuntu:20.04-amd64@sha256:5f8bbb08ab81d5ab53aa0a152b447e4d8c9a227d24bf535ec0bbc09667441b5d

# hadolint ignore=DL3008,DL3009
RUN set -ex && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    docker.io

RUN mkdir -p /etc/docker/ && echo '{"registry-mirrors": ["http://localhost:5000"] }' >/etc/docker/daemon.json
