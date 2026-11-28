package com.alz.controller;

import com.alz.assistant.SpeechTranscriptionService;
import com.alz.config.StoragePaths;
import com.alz.exception.ScreeningServiceException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/assistant/speech")
public class AssistantSpeechController {

    private static final long MAX_AUDIO_BYTES = 25L * 1024L * 1024L;
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of("wav", "webm", "ogg", "mp3", "m4a", "mp4");

    private final SpeechTranscriptionService transcriptionService;
    private final StoragePaths storagePaths;

    public AssistantSpeechController(SpeechTranscriptionService transcriptionService,
                                     StoragePaths storagePaths) {
        this.transcriptionService = transcriptionService;
        this.storagePaths = storagePaths;
    }

    @PostMapping("/transcribe")
    public Map<String, String> transcribe(@RequestParam("file") MultipartFile file) throws IOException {
        validate(file);
        String extension = extensionOf(file.getOriginalFilename());
        Files.createDirectories(storagePaths.audioDirectory());
        Path temporary = storagePaths.resolveAudio("assistant-" + UUID.randomUUID() + "." + extension);
        try {
            file.transferTo(temporary);
            return Map.of("transcription", transcriptionService.transcribe(temporary));
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static void validate(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "录音内容为空");
        }
        if (file.getSize() > MAX_AUDIO_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "录音文件不能超过25MB");
        }
        String extension = extensionOf(file.getOriginalFilename());
        if (!ALLOWED_EXTENSIONS.contains(extension)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不支持该录音格式");
        }
    }

    private static String extensionOf(String filename) {
        if (filename == null) return "webm";
        int dot = filename.lastIndexOf('.');
        if (dot < 0 || dot == filename.length() - 1) return "webm";
        return filename.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    @ExceptionHandler(ScreeningServiceException.class)
    public ResponseEntity<Map<String, String>> transcriptionFailure(ScreeningServiceException exception) {
        HttpStatus status = exception instanceof SpeechTranscriptionService.NoSpeechException
                ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_GATEWAY;
        return ResponseEntity.status(status).body(Map.of("message", exception.getMessage()));
    }
}
