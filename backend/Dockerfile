ARG REGISTRY_PREFIX=
FROM ${REGISTRY_PREFIX}library/maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /build
COPY settings-docker.xml /root/.m2/settings.xml
COPY pom.xml .
RUN mvn --batch-mode --no-transfer-progress dependency:go-offline
COPY src ./src
RUN mvn --batch-mode --no-transfer-progress -DskipTests package

ARG REGISTRY_PREFIX=
FROM ${REGISTRY_PREFIX}library/eclipse-temurin:17-jre

ARG DEBIAN_MIRROR=https://mirrors.ustc.edu.cn/debian
ARG UBUNTU_MIRROR=https://mirrors.ustc.edu.cn/ubuntu
RUN find /etc/apt -maxdepth 2 -type f -exec sed -i \
        -e "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" \
        -e "s|http://archive.ubuntu.com/ubuntu|${UBUNTU_MIRROR}|g" \
        -e "s|http://security.ubuntu.com/ubuntu|${UBUNTU_MIRROR}|g" {} + \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/target/*.jar /app/app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
