# Build on Linux with Linux native libraries (OpenCV, FFmpeg), then run on a small Java runtime image.
FROM eclipse-temurin:25-jdk AS build
WORKDIR /src
COPY mvnw pom.xml ./
COPY .mvn .mvn
# .mvn/maven.config pins Windows binaries for local work; the server needs Linux ones.
RUN rm -f .mvn/maven.config && chmod +x mvnw \
    && ./mvnw -q -B -Djavacpp.platform=linux-x86_64 dependency:go-offline
COPY src src
RUN ./mvnw -q -B -Djavacpp.platform=linux-x86_64 -DskipTests package

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /src/target/SlackWater-0.0.1-SNAPSHOT.jar app.jar
# The real clips the app measures on startup (see clips/seed.csv).
COPY clips clips
ENV JAVA_TOOL_OPTIONS="--enable-native-access=ALL-UNNAMED -XX:MaxRAMPercentage=70"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
