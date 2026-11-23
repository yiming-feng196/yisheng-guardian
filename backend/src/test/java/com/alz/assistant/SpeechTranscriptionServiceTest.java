package com.alz.assistant;

import com.alz.exception.ScreeningServiceException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
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

        assertThrows(ScreeningServiceException.class,
                () -> service.transcribe(Path.of("/data/audio/test.webm")));
    }
}
