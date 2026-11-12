package com.qwenmate.handler.file;

/**
 * 打开文件后光标与选区的落点。
 *
 * <p>把"光标停在哪一行、选中哪一段"从 IDE API 里抽出来做成纯计算，
 * 这样边界行为（空文件、行号越界、区间裁剪、空区间）可以脱离 IDE 直接单测，
 * 而不必起一个真实的编辑器窗口。</p>
 *
 * <p>行号对外一律是 <b>1 起始</b>（与用户在消息里写的 {@code file.py:100} 一致），
 * 内部换算成 <b>0 起始</b>的行下标。</p>
 */
public final class EditorNavigationTarget {

    /**
     * 行/偏移查询的最小抽象。
     *
     * <p>生产环境由 {@code Document} 适配，单元测试里用一段纯文本实现，
     * 从而让落点计算不依赖 IntelliJ 平台。</p>
     */
    public interface LineGeometry {

        /** 文档总行数。 */
        int lineCount();

        /** 指定行（0 起始）的起始偏移。 */
        int lineStartOffset(int line);

        /** 指定行（0 起始）的结束偏移，不含行尾换行符。 */
        int lineEndOffset(int line);
    }

    private final int line;
    private final int startOffset;
    private final int endOffset;
    private final boolean selection;

    EditorNavigationTarget(int line, int startOffset, int endOffset, boolean selection) {
        this.line = line;
        this.startOffset = startOffset;
        this.endOffset = endOffset;
        this.selection = selection;
    }

    /** 目标行，0 起始。 */
    public int line() {
        return line;
    }

    /** 选区起点偏移（同时也是光标落点）。 */
    public int startOffset() {
        return startOffset;
    }

    /** 选区终点偏移；无选区时与 {@link #startOffset()} 相同。 */
    public int endOffset() {
        return endOffset;
    }

    /** 是否需要设置选区。 */
    public boolean hasSelection() {
        return selection;
    }

    /**
     * 计算光标与选区的落点。
     *
     * <p>规则（与重构前的同步打开路径保持一致）：</p>
     * <ul>
     *   <li>行号超出文档范围时，夹到文档的最后一行；</li>
     *   <li>{@code endLineNumber >= lineNumber} 时选区覆盖
     *       {@code [目标行行首, 结束行行尾]}；否则只移动光标、不选区；</li>
     *   <li>区间结束行同样会被夹到文档最后一行。</li>
     * </ul>
     *
     * @param geometry 行/偏移来源
     * @param lineNumber 目标行，1 起始
     * @param endLineNumber 区间结束行，1 起始；小于等于 {@code lineNumber} 时不选区
     * @return 落点；文档没有任何行时返回 {@code null}
     */
    public static EditorNavigationTarget resolve(
            LineGeometry geometry, int lineNumber, int endLineNumber) {
        if (geometry == null) {
            return null;
        }
        int lineCount = geometry.lineCount();
        if (lineCount <= 0) {
            // 空文件没有可落的位置
            return null;
        }

        int zeroBasedLine = clampToLine(lineNumber, lineCount);
        int startOffset = geometry.lineStartOffset(zeroBasedLine);

        if (endLineNumber >= lineNumber) {
            int zeroBasedEndLine = clampToLine(endLineNumber, lineCount);
            int endOffset = geometry.lineEndOffset(zeroBasedEndLine);
            return new EditorNavigationTarget(zeroBasedLine, startOffset, endOffset, true);
        }
        return new EditorNavigationTarget(zeroBasedLine, startOffset, startOffset, false);
    }

    /**
     * 把 1 起始的行号换算成 0 起始的下标，并夹到 {@code [0, lineCount - 1]}。
     */
    private static int clampToLine(int lineNumber, int lineCount) {
        return Math.min(Math.max(0, lineNumber - 1), lineCount - 1);
    }
}
