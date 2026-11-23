package com.alz.assistant;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Component
public class KeywordAdQuestionRouter implements AdQuestionRouter {

    private static final Map<AdQuestionCategory, List<String>> SIGNALS = createSignals();

    @Override
    public AdQuestionRoute route(String question) {
        if (question == null || question.isBlank()) {
            return new AdQuestionRoute(AdQuestionCategory.OUT_OF_SCOPE, 0, false, List.of(), "问题为空");
        }

        String normalized = normalize(question);
        List<String> crisisSignals = matches(normalized, List.of(
                "自伤", "想自杀", "想伤害自己", "不想活", "想死", "结束生命", "想伤人"));
        if (!crisisSignals.isEmpty()) {
            return new AdQuestionRoute(AdQuestionCategory.CRISIS, 0.95, true, crisisSignals,
                    "优先提供人身安全和即时支持");
        }
        List<String> emergencySignals = matches(normalized, SIGNALS.get(AdQuestionCategory.EMERGENCY));
        if (!emergencySignals.isEmpty()) {
            return new AdQuestionRoute(
                    AdQuestionCategory.EMERGENCY,
                    confidence(emergencySignals.size()),
                    true,
                    emergencySignals,
                    "检测到需要优先处理的急症信号"
            );
        }

        // Broad words such as "怎么办", "睡眠" and "什么是" must not turn
        // everyday conversation into an Alzheimer's knowledge-base query.
        List<String> cognitiveSignals = matches(normalized, List.of(
                "阿尔茨海默", "老年痴呆", "痴呆", "认知", "记忆", "忘事", "忘记", "健忘",
                "重复提问", "迷路", "走失", "找不到词", "筛查", "脑健康", "照护", "老年", "老人", "mci"));
        if (cognitiveSignals.isEmpty() && !normalized.equals("ad")) {
            return new AdQuestionRoute(AdQuestionCategory.COMPANIONSHIP, 0.8, false, List.of(),
                    "日常交流、情绪支持或一般生活话题");
        }
        AdQuestionCategory bestCategory = AdQuestionCategory.OUT_OF_SCOPE;
        List<String> bestMatches = List.of();
        for (AdQuestionCategory category : List.of(
                AdQuestionCategory.INTRODUCTION,
                AdQuestionCategory.SYMPTOMS,
                AdQuestionCategory.COPING)) {
            List<String> categoryMatches = matches(normalized, SIGNALS.get(category));
            if (categoryMatches.size() > bestMatches.size()) {
                bestCategory = category;
                bestMatches = categoryMatches;
            }
        }

        if (bestCategory == AdQuestionCategory.OUT_OF_SCOPE) {
            if (normalized.contains("阿尔茨海默") || normalized.contains("老年痴呆") || normalized.equals("ad")) {
                return new AdQuestionRoute(
                        AdQuestionCategory.INTRODUCTION,
                        0.60,
                        false,
                        List.of("阿尔茨海默病"),
                        "问题提及阿尔茨海默病，但没有更具体的主题信号"
                );
            }
            return new AdQuestionRoute(AdQuestionCategory.COMPANIONSHIP, 0.6, false, List.of(), "开放式陪伴交流");
        }
        return new AdQuestionRoute(
                bestCategory,
                confidence(bestMatches.size()),
                false,
                bestMatches,
                "问题属于“" + bestCategory.displayName() + "”知识域"
        );
    }

    private static Map<AdQuestionCategory, List<String>> createSignals() {
        Map<AdQuestionCategory, List<String>> signals = new EnumMap<>(AdQuestionCategory.class);
        signals.put(AdQuestionCategory.EMERGENCY, List.of(
                "突然说不清", "突然不能说话", "突然口齿不清", "口角歪斜", "一侧无力", "单侧无力",
                "突然昏迷", "意识不清", "抽搐", "剧烈头痛", "自伤", "伤人"
        ));
        signals.put(AdQuestionCategory.INTRODUCTION, List.of(
                "什么是", "介绍", "痴呆区别", "正常衰老", "原因", "病因",
                "风险因素", "遗传", "传染", "年轻人", "早发", "阶段", "分期", "轻度认知障碍", "mci"
        ));
        signals.put(AdQuestionCategory.SYMPTOMS, List.of(
                "症状", "表现", "征兆", "忘事", "记忆", "重复提问", "找不到词", "语言", "迷路", "方向",
                "时间混乱", "不会算账", "判断力", "性格", "情绪", "幻觉", "睡眠", "生活能力", "突然糊涂"
        ));
        signals.put(AdQuestionCategory.COPING, List.of(
                "怎么办", "应对", "预防", "降低风险", "风险管理", "风险", "运动", "饮食", "睡眠", "血压", "就医", "医院", "挂什么科",
                "检查", "诊断", "治疗", "药物", "治愈", "照护", "护理", "家属", "走失", "沟通", "照顾",
                "吞咽", "吃饭", "用药", "记忆门诊"
        ));
        return Map.copyOf(signals);
    }

    private static List<String> matches(String text, List<String> signals) {
        List<String> matched = new ArrayList<>();
        for (String signal : signals) {
            if (text.contains(signal)) {
                matched.add(signal);
            }
        }
        return List.copyOf(matched);
    }

    private static String normalize(String value) {
        return value.toLowerCase(Locale.ROOT)
                .replace("alzheimer's", "阿尔茨海默")
                .replace("alzheimers", "阿尔茨海默")
                .replaceAll("\\s+", "");
    }

    private static double confidence(int signalCount) {
        return Math.min(0.97, 0.66 + signalCount * 0.09);
    }
}
