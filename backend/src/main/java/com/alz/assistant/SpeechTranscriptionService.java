package com.alz.assistant;

import com.alz.exception.ScreeningServiceException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;

@Service
public class SpeechTranscriptionService {

    private final RestTemplate restTemplate;
    private final String transcriptionUrl;

    @Autowired
    public SpeechTranscriptionService(
            @Value("${app.python.transcription-url:http://127.0.0.1:5000/api/transcription}") String transcriptionUrl,
            @Value("${app.python.connect-timeout-ms:3000}") int connectTimeoutMs,
            @Value("${app.python.read-timeout-ms:120000}") int readTimeoutMs) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(Duration.ofMillis(connectTimeoutMs));
        requestFactory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
        this.restTemplate = new RestTemplate(requestFactory);
        this.transcriptionUrl = transcriptionUrl;
    }

    SpeechTranscriptionService(RestTemplate restTemplate, String transcriptionUrl) {
        this.restTemplate = restTemplate;
        this.transcriptionUrl = transcriptionUrl;
    }

    public String transcribe(Path audioPath) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, String>> request = new HttpEntity<>(
                Map.of("audio_path", audioPath.toAbsolutePath().normalize().toString()), headers);
        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(
                    transcriptionUrl, request, Map.class);
            Object value = response.getBody() == null ? null : response.getBody().get("transcription");
            if (value == null || value.toString().isBlank()) {
                throw new ScreeningServiceException("没有识别到有效语音");
            }
            return value.toString().trim();
        } catch (HttpStatusCodeException exception) {
            String message = "语音转写失败";
            try {
                Object remote = exception.getResponseBodyAs(Map.class).get("message");
                if (remote != null && !remote.toString().isBlank()) message = remote.toString();
            } catch (RuntimeException ignored) { }
            throw new ScreeningServiceException(message, exception);
        } catch (ResourceAccessException exception) {
            throw new ScreeningServiceException("本地语音转写服务连接失败或处理超时", exception);
        }
    }
}
