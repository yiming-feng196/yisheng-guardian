package com.alz.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/assistant")
public class AssistantStatusController {
    private final boolean modelConfigured;

    public AssistantStatusController(@Value("${app.deepseek.enabled:false}") boolean enabled,
                                     @Value("${app.deepseek.api-key:}") String apiKey) {
        this.modelConfigured = enabled && apiKey != null && !apiKey.isBlank();
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        // Configuration status is not a claim that an external model has been reached.
        return Map.of("service", "yisheng-backend", "chatAvailable", true,
                "modelConfigured", modelConfigured,
                "answerMode", modelConfigured ? "model-configured" : "local-knowledge");
    }
}
