# Plugin com.qwenmate:1.1.1 against IU-233.15619.7

1 compatibility problem, some of which may be caused by absence of optional dependencies in the target IDE IU-233.15619.7

## Missing dependencies (2)

* com.intellij.modules.jcef (optional): Dependency 'com.intellij.modules.jcef (optional, v1, legacy module)' is not resolved. It was searched in the following locations: Local Plugin Repository, Bundled plugins of IU-233.15619.7, Local Plugin Repository
* com.intellij.modules.python (optional): Dependency 'com.intellij.modules.python (plugin+module, v2)' is not resolved. It was searched in the following locations: Local Plugin Repository, Bundled plugins of IU-233.15619.7, Local Plugin Repository

## Compatibility problems (1)

### Package 'com.jetbrains.python' is not found

* Package 'com.jetbrains.python' is not found along with its 12 classes.
* Probably the package 'com.jetbrains.python' belongs to a library or dependency that is not resolved by the checker.
* It is also possible, however, that this package was actually removed from a dependency causing the detected problems. Access to unresolved classes at runtime may lead to **NoSuchClassError**.
* The following classes of 'com.jetbrains.python' are not resolved (only 5 most used classes are shown, 7 hidden):
*   Class com.jetbrains.python.psi.PyFile is referenced in
*     com.qwenmate.handler.context.PythonContextCollector.collectPythonContext(JsonObject semanticData, Editor editor, Project project, PsiFile psiFile, Document document) : void
*     com.qwenmate.handler.context.PythonContextCollector.getImports(PyFile pyFile) : JsonArray
*   Class com.jetbrains.python.psi.PyStringLiteralExpression is referenced in
*     com.qwenmate.handler.context.PythonContextCollector.extractStringLiteralText(PyStringLiteralExpression expression) : String
*     com.qwenmate.handler.context.PythonContextCollector.getCurrentScope(PsiFile psiFile, int offset) : JsonObject
*   Class com.jetbrains.python.psi.PyClass is referenced in
*     com.qwenmate.handler.context.PythonContextCollector.getCurrentScope(PsiFile psiFile, int offset) : JsonObject
*   Class com.jetbrains.python.psi.PyExpression is referenced in
*     com.qwenmate.handler.context.PythonContextCollector.getCurrentScope(PsiFile psiFile, int offset) : JsonObject
*   Class com.jetbrains.python.psi.PyExpressionStatement is referenced in
*     com.qwenmate.handler.context.PythonContextCollector.getCurrentScope(PsiFile psiFile, int offset) : JsonObject
* 

## Dynamic Plugin Status

Plugin can probably be enabled or disabled without IDE restart

