import gi, sys
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib
out = sys.argv[1]; secret = len(sys.argv) > 2 and sys.argv[2] == "password"
w = Gtk.Window(title="phoenix-paste-target"); w.set_default_size(400, 80)
e = Gtk.Entry(); e.set_visibility(not secret); w.add(e)
def changed(_):
    open(out, "w").write(e.get_text())
e.connect("changed", changed); w.connect("destroy", Gtk.main_quit)
w.show_all(); open(out, "w").write(""); Gtk.main()
