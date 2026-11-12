package com.qwenmate.handler.file;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * 打开文件时光标/选区落点的回归测试。
 *
 * <p>覆盖三类最容易出错的场景：行号越界、区间裁剪、空文件。</p>
 */
public class EditorNavigationTargetTest {

    /**
     * 纯文本实现的行/偏移来源，语义与 IntelliJ 的 {@code Document} 一致：
     * 空文本算一行，行尾分隔符不计入行内容。
     */
    private static final class StringGeometry implements EditorNavigationTarget.LineGeometry {

        private final String text;

        StringGeometry(String text) {
            this.text = text;
        }

        @Override
        public int lineCount() {
            if (text.isEmpty()) {
                return 1;
            }
            int lines = 1;
            for (int i = 0; i < text.length(); i++) {
                if (text.charAt(i) == '\n') {
                    lines++;
                }
            }
            return lines;
        }

        @Override
        public int lineStartOffset(int line) {
            int offset = 0;
            for (int i = 0; i < line; i++) {
                offset = text.indexOf('\n', offset) + 1;
            }
            return offset;
        }

        @Override
        public int lineEndOffset(int line) {
            int start = lineStartOffset(line);
            int newline = text.indexOf('\n', start);
            return newline < 0 ? text.length() : newline;
        }
    }

    /**
     * alpha(0-4) \n beta(6-9) \n gamma(11-15) \n delta(17-21)
     */
    private static StringGeometry fourLines() {
        return new StringGeometry("alpha\nbeta\ngamma\ndelta");
    }

    // ---------- 单行落点 ----------

    @Test
    public void resolve_singleLine_movesCaretToLineStart() {
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(fourLines(), 2, -1);

        assertNotNull(target);
        assertEquals(1, target.line());
        assertEquals(6, target.startOffset());
        assertFalse(target.hasSelection());
        // 无选区时终点与起点相同，光标不会被移动到别处
        assertEquals(target.startOffset(), target.endOffset());
    }

    @Test
    public void resolve_firstLine_landsOnOffsetZero() {
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(fourLines(), 1, -1);

        assertNotNull(target);
        assertEquals(0, target.line());
        assertEquals(0, target.startOffset());
    }

    @Test
    public void resolve_nonPositiveLine_clampsToFirstLine() {
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(fourLines(), 0, -1);

        assertNotNull(target);
        assertEquals(0, target.line());
        assertEquals(0, target.startOffset());
    }

    // ---------- 区间选区 ----------

    @Test
    public void resolve_lineRange_selectsFromStartLineToEndOfEndLine() {
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(fourLines(), 2, 3);

        assertNotNull(target);
        assertTrue(target.hasSelection());
        assertEquals(1, target.line());
        // 起点是第 2 行行首，终点是第 3 行行尾（不含换行符）
        assertEquals(6, target.startOffset());
        assertEquals(16, target.endOffset());
    }

    @Test
    public void resolve_singleLineRange_stillSelectsThatWholeLine() {
        // end == line 时依然算区间：整行被选中（与重构前行为一致）
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(fourLines(), 2, 2);

        assertNotNull(target);
        assertTrue(target.hasSelection());
        assertEquals(6, target.startOffset());
        assertEquals(10, target.endOffset());
    }

    @Test
    public void resolve_endBeforeStart_doesNotSelect() {
        // 区间结束行早于起始行 → 只移动光标
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(fourLines(), 3, 2);

        assertNotNull(target);
        assertFalse(target.hasSelection());
        assertEquals(2, target.line());
        assertEquals(11, target.startOffset());
        assertEquals(target.startOffset(), target.endOffset());
    }

    @Test
    public void resolve_missingEndLine_doesNotSelect() {
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(fourLines(), 3, -1);

        assertNotNull(target);
        assertFalse(target.hasSelection());
    }

    // ---------- 越界裁剪 ----------

    @Test
    public void resolve_lineBeyondEnd_clampsToLastLine() {
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(fourLines(), 99, -1);

        assertNotNull(target);
        assertEquals(3, target.line());
        assertEquals(17, target.startOffset());
    }

    @Test
    public void resolve_endLineBeyondEnd_clampsToLastLine() {
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(fourLines(), 2, 99);

        assertNotNull(target);
        assertTrue(target.hasSelection());
        assertEquals(6, target.startOffset());
        // 终点夹到最后一行行尾（delta 占 17..21，行尾偏移 22）
        assertEquals(22, target.endOffset());
    }

    @Test
    public void resolve_rangeBeyondEnd_keepsStartOnRequestedLine() {
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(fourLines(), 4, 99);

        assertNotNull(target);
        assertEquals(3, target.line());
        assertEquals(17, target.startOffset());
        assertEquals(22, target.endOffset());
    }

    // ---------- 空文件 / 异常输入 ----------

    @Test
    public void resolve_emptyDocument_landsOnTheSingleEmptyLine() {
        // 空文本仍然算一行，光标落在偏移 0
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(new StringGeometry(""), 1, -1);

        assertNotNull(target);
        assertEquals(0, target.line());
        assertEquals(0, target.startOffset());
        assertFalse(target.hasSelection());
    }

    @Test
    public void resolve_documentWithoutLines_returnsNull() {
        EditorNavigationTarget.LineGeometry empty = new EditorNavigationTarget.LineGeometry() {
            @Override
            public int lineCount() {
                return 0;
            }

            @Override
            public int lineStartOffset(int line) {
                return 0;
            }

            @Override
            public int lineEndOffset(int line) {
                return 0;
            }
        };

        assertNull(EditorNavigationTarget.resolve(empty, 1, -1));
    }

    @Test
    public void resolve_nullGeometry_returnsNull() {
        assertNull(EditorNavigationTarget.resolve(null, 1, -1));
    }

    @Test
    public void resolve_trailingNewline_countsExtraEmptyLine() {
        // "alpha\n" 有两行：第二行是空的
        EditorNavigationTarget target =
                EditorNavigationTarget.resolve(new StringGeometry("alpha\n"), 2, -1);

        assertNotNull(target);
        assertEquals(1, target.line());
        assertEquals(6, target.startOffset());
    }
}
