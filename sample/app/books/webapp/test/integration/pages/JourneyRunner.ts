import JourneyRunner from "sap/fe/test/JourneyRunner";
import ListReport from "sap/fe/test/ListReport";
import ObjectPage from "sap/fe/test/ObjectPage";
import CustomBooksListGenerated from "./BooksList.gen";
import CustomBooksObjectPageGenerated from "./BooksObjectPage.gen";
import CustomChaptersObjectPageGenerated from "./ChaptersObjectPage.gen";

const runner = new JourneyRunner({
    launchUrl: sap.ui.require.toUrl("ui5webmcpodatasamplebooks") + "/test/flp.html#app-preview",
    pages: {
        onTheBooksListGenerated: new ListReport(
            {
                appId: "ui5webmcpodatasamplebooks",
                componentId: "BooksList",
                entitySet: "",
                contextPath: "/Books"
            },
            CustomBooksListGenerated
        ),
        onTheBooksObjectPageGenerated: new ObjectPage(
            {
                appId: "ui5webmcpodatasamplebooks",
                componentId: "BooksObjectPage",
                entitySet: "",
                contextPath: "/Books"
            },
            CustomBooksObjectPageGenerated
        ),
        onTheChaptersObjectPageGenerated: new ObjectPage(
            {
                appId: "ui5webmcpodatasamplebooks",
                componentId: "ChaptersObjectPage",
                entitySet: "",
                contextPath: "/Books/chapters"
            },
            CustomChaptersObjectPageGenerated
        )
    },
    async: true
});

export default runner;
