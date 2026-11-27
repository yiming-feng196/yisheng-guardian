package com.alz.controller;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import java.net.InetSocketAddress;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class AssistantVoiceControllerTest {
    @Test void rejectsEmptyAndOversizeBeforeContactingWorker() {
        var controller = new AssistantVoiceController("http://127.0.0.1:1");
        assertEquals(400, assertThrows(ResponseStatusException.class,
                () -> controller.synthesize(Map.of("text", " "))).getStatusCode().value());
        assertEquals(400, assertThrows(ResponseStatusException.class,
                () -> controller.synthesize(Map.of("text", "字".repeat(3001)))).getStatusCode().value());
    }
    @Test void proxiesAudioAndDisablesCaching() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        byte[] bytes = new byte[200];
        server.createContext("/synthesize", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "audio/mpeg");
            exchange.sendResponseHeaders(200, bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });server.start();
        try {
            var controller = new AssistantVoiceController("http://127.0.0.1:" + server.getAddress().getPort());
            var response = controller.synthesize(Map.of("text", "你好，小忆"));
            assertArrayEquals(bytes, response.getBody());
            assertEquals("audio/mpeg", response.getHeaders().getContentType().toString());
            assertEquals("no-store", response.getHeaders().getCacheControl());
        } finally { server.stop(0); }
    }
    @Test void unavailableWorkerIsNotReportedAsReady() {
        assertEquals(503, assertThrows(ResponseStatusException.class,
                () -> new AssistantVoiceController("http://127.0.0.1:1").status()).getStatusCode().value());
    }
}
