package com.alz.assistant;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KeywordAdQuestionRouterTest {

    private final AdQuestionRouter router = new KeywordAdQuestionRouter();

    @Test
    void routesIntroductionQuestion() {
        AdQuestionRoute route = router.route("阿尔茨海默病是什么原因引起的？");

        assertEquals(AdQuestionCategory.INTRODUCTION, route.category());
        assertFalse(route.urgent());
    }

    @Test
    void routesSymptomQuestion() {
        AdQuestionRoute route = router.route("老人最近经常迷路，还反复忘事");

        assertEquals(AdQuestionCategory.SYMPTOMS, route.category());
    }

    @Test
    void routesRiskReductionQuestionToCoping() {
        AdQuestionRoute route = router.route("如何降低阿尔茨海默病风险？");

        assertEquals(AdQuestionCategory.COPING, route.category());
    }

    @Test
    void prioritizesEmergencySignals() {
        AdQuestionRoute route = router.route("老人突然说不清话而且一侧无力，是阿尔茨海默病吗？");

        assertEquals(AdQuestionCategory.EMERGENCY, route.category());
        assertTrue(route.urgent());
    }

    @Test
    void routesEverydayTopicsToCompanionship() {
        AdQuestionRoute route = router.route("明天上海天气怎么样？");

        assertEquals(AdQuestionCategory.COMPANIONSHIP, route.category());
    }

    @Test
    void ordinaryEmotionAndBroadKeywordsDoNotTriggerAlzheimerKnowledge() {
        for (String question : java.util.List.of("今天情绪不好怎么办？", "什么是幸福？", "工作压力大，睡眠不好", "讲一个温暖的故事")) {
            assertEquals(AdQuestionCategory.COMPANIONSHIP, router.route(question).category());
        }
    }

    @Test
    void selfHarmNeedsRelevantImmediateSupportRatherThanStrokeAdvice() {
        assertEquals(AdQuestionCategory.CRISIS, router.route("我不想活了").category());
        assertTrue(router.route("我想伤害自己").urgent());
    }
}
