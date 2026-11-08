FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /build
COPY apps/java-api/pom.xml ./
RUN mvn -B dependency:go-offline
COPY apps/java-api/src ./src
RUN mvn -B package -DskipTests
FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache curl && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /build/target/shangcheng-api-0.1.0.jar app.jar
USER app
EXPOSE 8080
ENTRYPOINT ["java","-XX:MaxRAMPercentage=70","-jar","app.jar"]
