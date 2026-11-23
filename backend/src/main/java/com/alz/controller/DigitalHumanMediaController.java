package com.alz.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

import static org.springframework.http.HttpStatus.NOT_FOUND;

@RestController
@RequestMapping("/assistant/digital-human")
public class DigitalHumanMediaController {

    private static final String JOB_ID_PATTERN = "[0-9a-f]{32}";

    private final Path dataDirectory;

    public DigitalHumanMediaController(
            @Value("${app.digital-human.data-dir:../digital-human-data}") String dataDirectory) {
        this.dataDirectory = Path.of(dataDirectory).toAbsolutePath().normalize();
    }

    @GetMapping("/renders/{jobId}/video")
    public ResponseEntity<Resource> video(@PathVariable String jobId) throws IOException {
        return media(jobId, "avatar.mp4", MediaType.valueOf("video/mp4"), "数字人视频尚未生成");
    }

    @GetMapping("/speech/{jobId}/audio")
    public ResponseEntity<Resource> audio(@PathVariable String jobId) throws IOException {
        return media(jobId, "speech-realtime.mp3", MediaType.valueOf("audio/mpeg"), "语音尚未生成");
    }

    private ResponseEntity<Resource> media(String jobId, String filename, MediaType mediaType,
                                           String missingMessage) throws IOException {
        if (!jobId.matches(JOB_ID_PATTERN)) {
            throw new ResponseStatusException(NOT_FOUND, "未找到媒体文件");
        }
        Path media = dataDirectory.resolve(jobId).resolve(filename).normalize();
        if (!media.startsWith(dataDirectory) || !Files.isRegularFile(media)) {
            throw new ResponseStatusException(NOT_FOUND, missingMessage);
        }
        FileSystemResource resource = new FileSystemResource(media);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(10)).cachePublic())
                .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                .contentType(mediaType)
                .contentLength(Files.size(media))
                .body(resource);
    }
}
