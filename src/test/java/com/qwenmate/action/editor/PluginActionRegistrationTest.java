package com.qwenmate.action.editor;

import org.junit.Assert;
import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class PluginActionRegistrationTest {

    @Test
    public void sendFilePathActionAppearsInProjectTreeAndEditorTabMenus() throws Exception {
        Set<String> groupIds = getActionGroupIds("QwenMate.SendFilePathToInputAction");

        Assert.assertTrue(groupIds.contains("ProjectViewPopupMenu"));
        Assert.assertTrue(groupIds.contains("EditorTabPopupMenu"));
    }

    @Test
    public void copySelectionReferenceActionAppearsInEditorPopupMenuAfterSendSelectionAction() throws Exception {
        ActionRegistration action = getActionRegistration("QwenMate.CopySelectionReferenceAction");
        ActionRegistration quickFixAction = getActionRegistration("QwenMate.QuickFixWithQwenMateAction");

        Assert.assertEquals(
                "com.qwenmate.action.editor.CopySelectionReferenceAction",
                action.actionClass
        );
        AddToGroupRegistration editorPopup = action.getAddToGroup("EditorPopupMenu");
        Assert.assertEquals("after", editorPopup.anchor);
        Assert.assertEquals("QwenMate.SendSelectionToTerminalAction", editorPopup.relativeToAction);
        Assert.assertTrue(action.declarationIndex < quickFixAction.declarationIndex);
    }

    @Test
    public void editorPopupActionsUseExpectedIcons() throws Exception {
        ActionRegistration sendSelectionAction = getActionRegistration("QwenMate.SendSelectionToTerminalAction");
        ActionRegistration copyReferenceAction = getActionRegistration("QwenMate.CopySelectionReferenceAction");
        ActionRegistration quickFixAction = getActionRegistration("QwenMate.QuickFixWithQwenMateAction");

        Assert.assertEquals("/icons/logo-16.png", sendSelectionAction.icon);
        Assert.assertEquals("/icons/logo-16.png", copyReferenceAction.icon);
        Assert.assertEquals("/icons/logo-16.png", quickFixAction.icon);
    }

    @Test
    public void sessionTemplateActionsAreRegistered() throws Exception {
        ActionRegistration saveAsTemplateAction = getActionRegistration("QwenMate.SaveAsTemplateAction");
        ActionRegistration createFromTemplateAction = getActionRegistration("QwenMate.CreateFromTemplateAction");

        Assert.assertEquals("com.qwenmate.action.SaveAsTemplateAction", saveAsTemplateAction.actionClass);
        Assert.assertEquals("com.qwenmate.action.CreateFromTemplateAction", createFromTemplateAction.actionClass);
    }

    @Test
    public void pluginDeclaresJcefAndUsesStableTemplateActionIcon() throws Exception {
        Document document = DocumentBuilderFactory.newInstance()
                .newDocumentBuilder()
                .parse(new File("src/main/resources/META-INF/plugin.xml"));

        NodeList dependencies = document.getElementsByTagName("depends");
        boolean hasOptionalJcefDependency = false;
        for (int i = 0; i < dependencies.getLength(); i++) {
            Node dependency = dependencies.item(i);
            Node optional = dependency.getAttributes().getNamedItem("optional");
            Node configFile = dependency.getAttributes().getNamedItem("config-file");
            if ("com.intellij.modules.jcef".equals(dependency.getTextContent().trim())
                    && optional != null && "true".equals(optional.getNodeValue())
                    && configFile != null && "jcef-features.xml".equals(configFile.getNodeValue())) {
                hasOptionalJcefDependency = true;
                break;
            }
        }
        Assert.assertTrue("JCEF must be optional for IDEs without the standalone module",
                hasOptionalJcefDependency);

        ActionRegistration saveAsTemplateAction = getActionRegistration("QwenMate.SaveAsTemplateAction");
        Assert.assertEquals("/icons/logo-16.png", saveAsTemplateAction.icon);
    }

    private static Set<String> getActionGroupIds(String actionId) throws Exception {
        return getActionRegistration(actionId).getGroupIds();
    }

    private static ActionRegistration getActionRegistration(String actionId) throws Exception {
        Document document = DocumentBuilderFactory.newInstance()
                .newDocumentBuilder()
                .parse(new File("src/main/resources/META-INF/plugin.xml"));
        NodeList actions = document.getElementsByTagName("action");
        for (int i = 0; i < actions.getLength(); i++) {
            Element action = (Element) actions.item(i);
            if (actionId.equals(action.getAttribute("id"))) {
                List<AddToGroupRegistration> addToGroupRegistrations = new ArrayList<>();
                NodeList addToGroups = action.getElementsByTagName("add-to-group");
                for (int j = 0; j < addToGroups.getLength(); j++) {
                    Element addToGroup = (Element) addToGroups.item(j);
                    addToGroupRegistrations.add(new AddToGroupRegistration(
                            addToGroup.getAttribute("group-id"),
                            addToGroup.getAttribute("anchor"),
                            addToGroup.getAttribute("relative-to-action")
                    ));
                }
                return new ActionRegistration(
                        action.getAttribute("class"),
                        action.getAttribute("icon"),
                        addToGroupRegistrations,
                        i
                );
            }
        }
        throw new AssertionError("Action not found: " + actionId);
    }

    private static final class ActionRegistration {
        private final String actionClass;
        private final String icon;
        private final List<AddToGroupRegistration> addToGroupRegistrations;
        private final int declarationIndex;

        private ActionRegistration(
                String actionClass,
                String icon,
                List<AddToGroupRegistration> addToGroupRegistrations,
                int declarationIndex
        ) {
            this.actionClass = actionClass;
            this.icon = icon;
            this.addToGroupRegistrations = addToGroupRegistrations;
            this.declarationIndex = declarationIndex;
        }

        private Set<String> getGroupIds() {
            Set<String> groupIds = new HashSet<>();
            for (AddToGroupRegistration registration : addToGroupRegistrations) {
                groupIds.add(registration.groupId);
            }
            return groupIds;
        }

        private AddToGroupRegistration getAddToGroup(String groupId) {
            for (AddToGroupRegistration registration : addToGroupRegistrations) {
                if (groupId.equals(registration.groupId)) {
                    return registration;
                }
            }
            throw new AssertionError("Group registration not found: " + groupId);
        }
    }

    private static final class AddToGroupRegistration {
        private final String groupId;
        private final String anchor;
        private final String relativeToAction;

        private AddToGroupRegistration(String groupId, String anchor, String relativeToAction) {
            this.groupId = groupId;
            this.anchor = anchor;
            this.relativeToAction = relativeToAction;
        }
    }
}
