# Inlines the demo screenshots into the film page.
import base64, pathlib
here = pathlib.Path(__file__).parent
assets = here.parent / "assets"
html = (here / "film.template.html").read_text()
for key, name in {"BEFORE": "before", "SKETCH": "sketch", "OPTION_A": "option-a", "OPTION_B": "option-b"}.items():
    html = html.replace("{{" + key + "}}", "data:image/png;base64," + base64.b64encode((assets / f"{name}.png").read_bytes()).decode())
(here / "film.html").write_text(html)
print("site/video/film.html")
