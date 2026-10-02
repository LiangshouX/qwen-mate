package com.qwenmate.provider.pricing;

/**
 * Qwen per-model pricing (USD per 1M tokens), input and output priced separately.
 *
 * <p>Shared single source of truth used by the per-turn message footer cost
 * ({@code UsageCostCalculator}) via {@link QwenPricingTable}.
 */
public record QwenPricing(
        double inputCostPer1M,
        double outputCostPer1M,
        double cacheWriteCostPer1M,
        double cacheReadCostPer1M
) {

    private static final double ONE_MILLION = 1_000_000.0;

    /** Bill a usage breakdown at this pricing. */
    public double costUsd(long inputTokens, long outputTokens, long cacheWriteTokens, long cacheReadTokens) {
        return bill(inputTokens, inputCostPer1M)
                + bill(outputTokens, outputCostPer1M)
                + bill(cacheWriteTokens, cacheWriteCostPer1M)
                + bill(cacheReadTokens, cacheReadCostPer1M);
    }

    private static double bill(long tokens, double ratePer1M) {
        return (tokens / ONE_MILLION) * ratePer1M;
    }
}
