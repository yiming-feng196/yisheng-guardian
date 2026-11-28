package com.alz.assistant;

import com.alz.controller.AssistantSpeechController;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;

class SpeechTranscriptionServiceTest {

    @Test
    void returnsTrimmedTranscription() {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        server.expect(requestTo("http://screening/api/transcription"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andRespond(withSuccess("{\"transcription\":\"  今天心情不错  \"}", MediaType.APPLICATION_JSON));

        SpeechTranscriptionService service = new SpeechTranscriptionService(
                restTemplate, "http://screening/api/transcription");

        assertEquals("今天心情不错", service.transcribe(Path.of("/data/audio/test.webm")));
        server.verify();
    }

    @Test
    void rejectsEmptyTranscription() {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        server.expect(requestTo("http://screening/api/transcription"))
                .andRespond(withSuccess("{\"transcription\":\"\"}", MediaType.APPLICATION_JSON));
        SpeechTranscriptionService service = new SpeechTranscriptionService(
                restTemplate, "http://screening/api/transcription");

        assertThrows(SpeechTranscriptionService.NoSpeechException.class,
                () -> service.transcribe(Path.of("/data/audio/test.webm")));
    }

    @Test
    void preservesNoSpeechStatusFromWorker() {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        server.expect(requestTo("http://screening/api/transcription"))
                .andRespond(withStatus(HttpStatus.UNPROCESSABLE_ENTITY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("{\"message\":\"没有识别到有效语音\"}"));
        SpeechTranscriptionService service = new SpeechTranscriptionService(
                restTemplate, "http://screening/api/transcription");

        var exception = assertThrows(SpeechTranscriptionService.NoSpeechException.class,
                () -> service.transcribe(Path.of("/data/audio/silence.webm")));
        var response = new AssistantSpeechController(service, null).transcriptionFailure(exception);
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, response.getStatusCode());
        assertEquals("没有识别到有效语音", response.getBody().get("message"));
        server.verify();
    }
}
