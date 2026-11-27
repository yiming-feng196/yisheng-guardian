package com.alz.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;
import java.time.Duration;
import java.util.Map;

/** Same-origin speech gateway: the mini-program never contacts internal Python ports. */
@RestController
@RequestMapping("/assistant/voice")
public class AssistantVoiceController {
    private final RestTemplate client;
    private final String base;
    public AssistantVoiceController(@Value("${app.voice.url:http://127.0.0.1:5010}") String base) {
        this.base = base.replaceAll("/+$", "");
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(3)); factory.setReadTimeout(Duration.ofSeconds(110));
        this.client = new RestTemplate(factory);
    }
    @GetMapping("/status")
    public Map<?, ?> status() {
        try { return client.getForObject(base + "/health", Map.class); }
        catch (RuntimeException e) { throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "语音服务未启动", e); }
    }
    @PostMapping(value="/synthesize", produces="audio/mpeg")
    public ResponseEntity<byte[]> synthesize(@RequestBody Map<String,String> request) {
        String text = request.getOrDefault("text", "");
        if (text == null || text.isBlank() || text.length() > 3000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "朗读内容需要 1–3000 字");
        try {
            byte[] audio = client.postForObject(base + "/synthesize", Map.of("text", text), byte[].class);
            if (audio == null || audio.length < 100) throw new IllegalStateException("Empty speech");
            return ResponseEntity.ok().contentType(MediaType.valueOf("audio/mpeg"))
                    .cacheControl(CacheControl.noStore()).body(audio);
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "语音生成失败，请检查语音服务或网络", e);
        }
    }
}
