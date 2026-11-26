package com.alz.controller;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class AssistantStatusControllerTest {
    @Test
    void localKnowledgeStatusIsExplicit() throws Exception {
        MockMvcBuilders.standaloneSetup(new AssistantStatusController(false, "")).build()
                .perform(get("/assistant/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.modelConfigured").value(false))
                .andExpect(jsonPath("$.answerMode").value("local-knowledge"));
    }

    @Test
    void statusNeverReturnsTheConfiguredCredential() throws Exception {
        MockMvcBuilders.standaloneSetup(new AssistantStatusController(true, "unit-test-credential")).build()
                .perform(get("/assistant/status"))
                .andExpect(jsonPath("$.modelConfigured").value(true))
                .andExpect(content().string(not(containsString("unit-test-credential"))));
    }
}
