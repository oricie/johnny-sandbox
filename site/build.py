# Builds the landing page as one self-contained file: images from site/assets are inlined as data URIs.
import base64, pathlib
here = pathlib.Path(__file__).parent
html = (here / "landing.template.html").read_text()
for key, name in {"BEFORE": "before", "SKETCH": "sketch", "OPTION_A": "option-a", "OPTION_B": "option-b"}.items():
    data = base64.b64encode((here / "assets" / f"{name}.png").read_bytes()).decode()
    html = html.replace("{{" + key + "}}", f"data:image/png;base64,{data}")
(here / "johnny-landing.html").write_text(html)
print(f"site/johnny-landing.html: {len(html) // 1024} KB")
