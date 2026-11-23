package com.alz.service.impl;

import com.alz.assistant.AdQuestionCategory;
import com.alz.assistant.AdQuestionRoute;
import com.alz.assistant.AdQuestionRouter;
import com.alz.assistant.AssistantStreamListener;
import com.alz.assistant.DeepSeekClient;
import com.alz.assistant.ConversationContext;
import com.alz.assistant.KnowledgeDocument;
import com.alz.assistant.KnowledgeRetriever;
import com.alz.assistant.LlmRequestConfig;
import com.alz.assistant.ThinkContentFilter;
import com.alz.assistant.WebSearchAnswer;
import com.alz.dto.AssistantChatResponse;
import com.alz.dto.AssistantSource;
import com.alz.dto.ScreeningGuideResponse;
import com.alz.service.AssistantService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.function.Consumer;

@Service
@Primary
public class RagAssistantServiceImpl implements AssistantService {

    private static final String DISCLAIMER =
            "本助手仅提供健康科普和风险筛查提示，不能诊断、排除或治疗阿尔茨海默病。请由正规医疗机构结合病史、认知与功能评估、体格检查及必要的辅助检查作出判断。";
    private static final String WEB_CAUTION =
            "联网资料未经本系统医学审核，信息可能过时或不准确，请谨慎甄别并向正规医疗机构核实。";

    private final AdQuestionRouter router;
    private final KnowledgeRetriever retriever;
    private final DeepSeekClient deepSeekClient;
    private final AssistantServiceImpl fallbackService;
    private final int topK;

    public RagAssistantServiceImpl(
            AdQuestionRouter router,
            KnowledgeRetriever retriever,
            DeepSeekClient deepSeekClient,
            AssistantServiceImpl fallbackService,
            @Value("${app.rag.top-k:4}") int topK
    ) {
        this.router = router;
        this.retriever = retriever;
        this.deepSeekClient = deepSeekClient;
        this.fallbackService = fallbackService;
        this.topK = Math.max(1, Math.min(topK, 8));
    }

    @Override
    public AssistantChatResponse chat(String message) {
        return chat(message, ConversationContext.empty());
    }

    public AssistantChatResponse chat(String message, ConversationContext memory) {
        return chat(message, memory, null);
    }

    public AssistantChatResponse chat(String message, ConversationContext memory,
                                      LlmRequestConfig config) {
        validate(message);
        AdQuestionRoute route = router.route(message);
        if (route.category() == AdQuestionCategory.CRISIS) return crisisResponse();
        if (route.category() == AdQuestionCategory.EMERGENCY) {
            return emergencyResponse();
        }
        if (route.category() == AdQuestionCategory.OUT_OF_SCOPE || route.category() == AdQuestionCategory.COMPANIONSHIP) {
            String answer = deepSeekClient.answer(message, companionRoute(), List.of(), memory, config)
                    .map(ThinkContentFilter::strip).filter(value -> !value.isBlank()).orElse(null);
            return companionResponse(answer, message);
        }

        List<KnowledgeDocument> knowledge = retriever.retrieve(message, route.category(), topK);
        if (knowledge.isEmpty()) {
            return webSearchResponse(message, route, config);
        }
        String answer = deepSeekClient.answer(message, route, knowledge, memory, config)
                .orElseGet(() -> knowledge.get(0).answer());
        return ragResponse(route, knowledge, ThinkContentFilter.strip(answer));
    }

    public AssistantChatResponse streamChat(String message, ConversationContext memory,
                                            Consumer<String> onDelta) {
        return streamChat(message, memory, null, new AssistantStreamListener() {
            @Override
            public void onAnswerDelta(String content) {
                onDelta.accept(content);
            }
        });
    }

    public AssistantChatResponse streamChat(String message, ConversationContext memory,
                                            AssistantStreamListener listener) {
        return streamChat(message, memory, null, listener);
    }

    public AssistantChatResponse streamChat(String message, ConversationContext memory,
                                            LlmRequestConfig config,
                                            AssistantStreamListener listener) {
        validate(message);
        if (config != null) {
            listener.onAnalysis("本次回答使用 %s（%s）。"
                    .formatted(config.provider().displayName(), config.model()));
        }
        AdQuestionRoute route = router.route(message);
        if (route.category() == AdQuestionCategory.CRISIS) {
            AssistantChatResponse response = crisisResponse();
            emitFallback(response.answer(), listener::onAnswerDelta);
            return response;
        }
        if (route.category() == AdQuestionCategory.EMERGENCY) {
            AssistantChatResponse response = emergencyResponse();
            emitFallback(response.answer(), listener::onAnswerDelta);
            return response;
        }
        if (route.category() == AdQuestionCategory.OUT_OF_SCOPE || route.category() == AdQuestionCategory.COMPANIONSHIP) {
            listener.onStatus("我在认真听，正在准备回应…");
            String answer = deepSeekClient.streamAnswer(message, companionRoute(), List.of(), memory, config,
                    listener::onAnswerDelta).map(ThinkContentFilter::strip).filter(value -> !value.isBlank()).orElse(null);
            AssistantChatResponse response = companionResponse(answer, message);
            if (answer == null) emitFallback(response.answer(), listener::onAnswerDelta);
            return response;
        }

        listener.onStatus("正在检索本地审核知识库…");
        List<KnowledgeDocument> knowledge = retriever.retrieve(message, route.category(), topK);
        if (knowledge.isEmpty()) {
            listener.onAnalysis("本地知识库没有足够匹配的内容，已转为联网检索。");
            listener.onStatus("正在联网检索权威资料…");
            WebSearchAnswer webAnswer = deepSeekClient
                    .streamAnswerWithWebSearch(message, route, config, listener)
                    .orElse(null);
            if (webAnswer == null) {
                AssistantChatResponse response = knowledgeUnavailableResponse();
                listener.onStatus("联网检索暂时不可用，已采用安全降级回答。");
                emitFallback(response.answer(), listener::onAnswerDelta);
                return response;
            }
            AssistantChatResponse response = toWebSearchResponse(route, webAnswer);
            if (!webAnswer.content().contains(WEB_CAUTION)) {
                listener.onAnswerDelta("\n\n" + WEB_CAUTION);
            }
            listener.onAnalysis("已整理 %d 个联网来源；请在重要医疗决定前核对原始资料。"
                    .formatted(webAnswer.sources().size()));
            return response;
        }
        listener.onAnalysis("已命中本地审核知识，正在组织回答。");
        listener.onStatus("正在生成回答…");
        String answer = deepSeekClient.streamAnswer(message, route, knowledge, memory, config, delta -> {
            if (delta != null && !delta.isEmpty()) listener.onAnswerDelta(delta);
        }).map(ThinkContentFilter::strip).filter(value -> !value.isBlank()).orElse(null);
        if (answer == null) {
            answer = ThinkContentFilter.strip(knowledge.get(0).answer());
            if (config != null) {
                listener.onStatus("所选模型调用失败，已切换为本地知识回答。");
                listener.onAnalysis("请检查 API Key、模型名称、账户余额和服务商网络状态。");
            }
            emitFallback(answer, listener::onAnswerDelta);
        }
        return ragResponse(route, knowledge, answer);
    }

    private static AssistantChatResponse ragResponse(AdQuestionRoute route,
                                                     List<KnowledgeDocument> knowledge,
                                                     String answer) {
        return new AssistantChatResponse(
                "rag_" + route.category().name().toLowerCase(),
                route.category().displayName(),
                answer,
                knowledge.stream()
                        .flatMap(document -> document.actionSuggestions().stream())
                        .distinct()
                        .limit(4)
                        .toList(),
                DISCLAIMER,
                knowledge.stream()
                        .flatMap(document -> document.sources().stream())
                        .distinct()
                        .limit(6)
                        .toList(),
                false
        );
    }

    private static void emitFallback(String answer, Consumer<String> onDelta) {
        String clean = ThinkContentFilter.strip(answer);
        int chunkSize = 24;
        for (int offset = 0; offset < clean.length(); offset += chunkSize) {
            onDelta.accept(clean.substring(offset, Math.min(clean.length(), offset + chunkSize)));
        }
    }

    @Override
    public ScreeningGuideResponse screeningGuide() {
        return fallbackService.screeningGuide();
    }

    @Override
    public List<String> supportedTopics() {
        return List.of("日常聊天", "情感陪伴", "认知健康", "语音筛查", "家庭照护");
    }

    private static void validate(String message) {
        if (message == null || message.isBlank()) {
            throw new IllegalArgumentException("问题不能为空");
        }
        if (message.length() > 500) {
            throw new IllegalArgumentException("问题不能超过500字");
        }
    }

    private static AssistantChatResponse emergencyResponse() {
        return new AssistantChatResponse(
                "emergency",
                "请立即处理急症信号",
                "突然出现语言障碍、口角歪斜、单侧肢体无力、意识异常或抽搐，可能是卒中等急症，不应等待在线回答或语音筛查结果。请立即拨打120，并记录症状最早出现的时间。不要自行驾车就医。",
                List.of("立即拨打120", "记录症状最早出现时间", "保持安全并等待专业救援"),
                DISCLAIMER,
                List.of(new AssistantSource(
                        "国家卫生健康委：脑卒中防治相关健康提示",
                        "https://www.nhc.gov.cn/"
                )),
                true
        );
    }

    private static AdQuestionRoute companionRoute() {
        return new AdQuestionRoute(AdQuestionCategory.COMPANIONSHIP, 0.8, false, List.of(), "日常与情感陪伴");
    }

    private static AssistantChatResponse crisisResponse() {
        return new AssistantChatResponse(
                "crisis_support", "先一起确保你现在安全",
                "听到你这样说，我很关心你现在的安全。如果你可能马上伤害自己或他人，请立即拨打120或110，或请身边的人帮忙联系。尽量远离可能造成伤害的物品，去有可信任的人陪伴的地方。你现在身边有没有可以马上联系、陪着你的人？",
                List.of("立即联系身边可信任的人", "有即时危险时拨打120或110"),
                "线上陪伴不能替代紧急救援或专业帮助。", List.of(), true
        );
    }

    private static AssistantChatResponse companionResponse(String answer, String message) {
        String content = answer;
        if (content == null) {
            String invitation = message.contains("累") || message.contains("压力")
                    ? "听起来你需要歇一歇。先把手头的事情放下，喝口水，慢慢呼吸。你最想暂时放下哪件事？"
                    : message.contains("难过") || message.contains("孤独")
                    ? "谢谢你把这份感受告诉我。可以先找一个让你安心的地方，或者联系一位信任的人，说说今天发生了什么。"
                    : "我们可以聊聊今天的生活、现在的心情，也可以关注记忆变化。你想从哪件事说起？";
            content = "对话服务暂时没有连上。" + invitation;
        }
        return new AssistantChatResponse("companionship", "忆声姐姐", content,
                List.of(), "", List.of(), false);
    }

    private AssistantChatResponse webSearchResponse(
            String message, AdQuestionRoute route, LlmRequestConfig config) {
        return deepSeekClient.answerWithWebSearch(message, route, config)
                .map(answer -> toWebSearchResponse(route, answer))
                .orElseGet(RagAssistantServiceImpl::knowledgeUnavailableResponse);
    }

    private static AssistantChatResponse knowledgeUnavailableResponse() {
        return new AssistantChatResponse(
                        "knowledge_unavailable",
                        "暂时没有足够的可靠资料",
                        "本地审核知识库没有找到足够匹配的内容，联网检索当前也不可用。为避免提供未经核实的信息，我暂时不能回答这个问题。",
                        List.of("稍后重试", "咨询正规医疗机构", "遇到急症信号立即拨打120"),
                        DISCLAIMER,
                        List.of(),
                        false
                );
    }

    private static AssistantChatResponse toWebSearchResponse(AdQuestionRoute route, WebSearchAnswer answer) {
        String content = answer.content().trim();
        if (!content.contains(WEB_CAUTION)) {
            content = content + "\n\n" + WEB_CAUTION;
        }
        return new AssistantChatResponse(
                "web_" + route.category().name().toLowerCase(),
                "联网资料辅助回答",
                content,
                List.of("核对来源机构和发布日期", "重要医疗决定前咨询医生", "不要依据网络回答自行调整处方"),
                DISCLAIMER,
                answer.sources(),
                false
        );
    }
}
