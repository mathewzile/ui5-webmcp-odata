import BaseComponent from "sap/fe/core/AppComponent";
import ODataWebMCP from "ui5/webmcp/odata/WebMCP";

/**
 * @namespace ui5webmcpodatasamplebooks
 */
export default class Component extends BaseComponent {
  private _webMcp: Promise<AbortController | null> | null = null;

  public static metadata = {
    manifest: "json",
  };

  public init(): void {
    super.init();
    // Reads the $metadata and registers the tools; options come from the manifest ("sap.ui5"/"ui5.webmcp")
    this._webMcp = ODataWebMCP.registerForComponent(this);
  }

  public exit(): void {
    void this._webMcp?.then((controller) => controller?.abort());
    super.exit();
  }
}
