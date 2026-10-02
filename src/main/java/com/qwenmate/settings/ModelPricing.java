package com.qwenmate.settings;

/**
 * Pricing configuration for a custom model.
 *
 * <p>All fields are nullable: a {@code null} field means "not configured, fall back to
 * the default pricing for that token kind". This keeps the structure backward-compatible
 * when new pricing dimensions are introduced and lets users specify only the rates they know.
 *
 * <p>Units are USD per 1,000,000 tokens, consistent with the {@code *CostPer1M}
 * fields used by the per-turn message footer cost calculator.
 */
public record ModelPricing(
        Double inputCostPer1M,
        Double outputCostPer1M,
        Double cacheWriteCostPer1M,
        Double cacheReadCostPer1M
) {
    /**
     * Build a Claude-style pricing (all four dimensions).
     */
    public static ModelPricing claude(double input, double output, double cacheWrite, double cacheRead) {
        return new ModelPricing(input, output, cacheWrite, cacheRead);
    }

    /**
     * Build a Codex-style pricing (no cache-write dimension; Codex sessions do not track
     * cache-write tokens).
     */
    public static ModelPricing codex(double input, double output, double cacheRead) {
        return new ModelPricing(input, output, null, cacheRead);
    }
}
