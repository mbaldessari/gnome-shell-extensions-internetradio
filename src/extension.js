/* vim: set ai ts=4 sts=4 et sw=4 */
/**
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

const Lang = imports.lang;
const Gettext = imports.gettext;
const GLib = imports.gi.GLib;
const GMenu = imports.gi.GMenu;
const Gst = imports.gi.Gst;
const Gstpbutils = imports.gi.GstPbutils;
const PanelMenu = imports.ui.panelMenu;
const Pango = imports.gi.Pango; 
const PopupMenu = imports.ui.popupMenu;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Radios = Me.imports.radios;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;

var RadioUrls = Radios.RadioUrls;
var RadioPipe; // Gstreamer pipeline
var RadioPlay; 
var Debug = true; // Set it to true for debug logs in ~/.cache/gdm/session.log
var appsMenuButton;


function dbg_log(s) {
    if (Debug)
        log(s);
}

function initTranslations() {
    var localeDir = Me.dir.get_child('locale').get_path();

    if (GLib.file_test(localeDir, GLib.FileTest.EXISTS)) {
        Gettext.bindtextdomain('gnome-shell-extensions-internetradio', localeDir);
    } else {
        Gettext.bindtextdomain('gnome-shell-extensions-internetradio', Me.metadata.locale);
    }
}

function URLParser(u) {
    var query="", hash="", params, ret;
    if (u.indexOf("?") > 0) {
        query = u.substr(u.indexOf("?") + 1);
        params = query.split('&');
    } else
        params = u.split('&');

    ret = {};
    if (params) {
        for (var i = 0; i < params.length; i++) {
            var pair = params[i].split('=');
            var a,b;

            try { // try needed as most URI seem to be malformed or truncated
                a = decodeURIComponent(pair[0]);
                b = decodeURIComponent(pair[1]);
                if (a.length > 0)
                    ret[a] = b;
                } catch(err) {
                    dbg_log("Issue parsing: " + pair);
            }
        }
    }
    return ret;
}

const TrackTitle = new Lang.Class({                                                                      
    Name: "TrackTitle",                                                                                  

    _init: function(text, style) {
        this.actor = new St.Table({style_class: style});                                                 
        this.actor._delegate = this;                                                                     
        this._label = new St.Label();
        this.actor.add(this._label, {row: 0, col: 0});                                               

        this.setText(text);                                                                              
    },  

    setText: function(text) { 
        if (text == null)
            text = '';
        if (this._label.clutter_text) {
            this._label.clutter_text.line_wrap = true;                                                   
            this._label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;                          
            this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;                               
            this._label.clutter_text.set_text(text.toString());                                          
        }
    },  

    getText: function() {                                                                                
        return this._label.text;
    }   
});     

const TrackBox = new Lang.Class({
    Name: "TrackBox",
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function() {
        this.parent();

        this._playing = false;
        this.box = new St.Table();
        this._infos = new St.Table({style_class: "track-infos"});
        this._icon = new St.Icon({ icon_name: 'media-playback-stop-symbolic', icon_size: 22 });
        this._button = new St.Button();
        this._button.set_child(this._icon);
        this._button.connect('clicked', Lang.bind(this, this.togglePlay));
        this._button.set_style('padding: 10px');

        this.box.add(this._infos, {row: 0, col: 1, x_expand: true});
        this.box.add(this._button, {row: 0, col: 2, x_expand: false});

        this.addActor(this.box, {span: -1, expand: true});
    },

    addInfo: function(item, row) {
        this._infos.add(item.actor, {row: row, col: 1, y_expand: false});
    },

    activate: function (event) {
        this.togglePlay();
        this.parent(event);
    },

    togglePlay: function() {
        var ret, state;
        ret = RadioPipe.get_state(state);
        dbg_log("Radioplay: " + ret[1] + " - " + state + " _ " + Gst.GST_STATE_PLAYING);
        
        if (ret[1] == Gst.State.PLAYING) {
            RadioPipe.set_state(Gst.State.PAUSED);
            this._icon.set_icon_name('media-playback-start-symbolic');
        } else {
            RadioPipe.set_state(Gst.State.PLAYING);
            this._icon.set_icon_name('media-playback-stop-symbolic');
        }
    }
});

const PlayMenuItem = new Lang.Class({
    Name: 'RadioMenu.PlayMenuItem',
    Extends: PopupMenu.PopupMenuSection,

    _init: function (params) {
        this.parent(params);

        this.trackBox = new TrackBox();
        this.trackTitle = new TrackTitle('', 'track-title');
        this.trackInfo = new TrackTitle('', 'track-info');
        this.trackRadio = new TrackTitle('', 'track-radio');
        this.trackBox.addInfo(this.trackTitle, 0);
        this.trackBox.addInfo(this.trackInfo, 1);
        this.trackBox.addInfo(this.trackRadio, 2);
        this.addMenuItem(this.trackBox);
    },
});

const RadioMenuItem = new Lang.Class({
    Name: 'RadioMenu.RadioMenuItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function (name, url, params) {
        this.parent(params);
        this._name = name;
        this._url = url;
        this._bus = null;
        this._label = new St.Label({ text: name });
        this.addActor(this._label);
    },

    activate: function (event) {
        dbg_log("playing: " + this._url);
        RadioPipe.set_state(Gst.State.PAUSED); 
        RadioPipe.unref();
        RadioPipe = new Gst.parse_launch('playbin uri=' + this._url);
        this._bus = RadioPipe.get_bus();
        this._bus.connect("message", Lang.bind(this, this.processMessages));
        this._bus.add_signal_watch();
        RadioPipe.set_state(Gst.State.PLAYING);
        this.parent(event);
    },

    missingPlugin: function(message) {
        Main.notifyError("Missing gstreamer plugin", message);
    },

    processMessages: function(bus, message) {
        var tags;
        var i;
        var ret;
        var title = '', artist = '', album = '', homepage = '';

        if (message.type == Gst.MessageType.ELEMENT) {
            dbg_log("ELEMENT Message");
            if (Gstpbutils.is_missing_plugin_message(message)) {
                this.missingPlugin(Gstpbutils.missing_plugin_message_get_description(message));
            }
        } else if (message.type == Gst.MessageType.TAG) {
            tags = message.parse_tag();
            for (i = 0; i < tags.n_tags(); i++) {
                dbg_log("i: " + i + " - " + tags.nth_tag_name(i) + " - " + tags.get_value_index(tags.nth_tag_name(i), 0));
            }
            [ret, title] = tags.get_string_index("title", 0);
            [ret, artist] = tags.get_string_index("artist", 0);
            [ret, album] = tags.get_string_index("album", 0);

            // homepage as last as it seems most accurate in most radios (?)
            [ret, homepage] = tags.get_string_index("homepage", 0);
            dbg_log("homepage: " + homepage);
            if (ret) {
                var args = URLParser(homepage);
                for (var i in args) {
                    dbg_log(i + ": " + args[i]);
                }

                if (args.hasOwnProperty('title'))
                    title = args['title']
                if (args.hasOwnProperty('artist'))
                    artist = args['artist']
                if (args.hasOwnProperty('album'))
                    album = args['album']
            }
            dbg_log("Title: " + title + " - Artist: " + artist + " - Album: " + album);
            RadioPlay.trackTitle.setText(title);
            if (artist != null && album != null)
                RadioPlay.trackInfo.setText(artist + " - " + album);
            else
                RadioPlay.trackInfo.setText(null);
            RadioPlay.trackRadio.setText(this._name);
        } else {
            dbg_log("Other Message:" + message.type);
        }
    }
});

const RadioButton = new Lang.Class({
    Name: 'RadioMenu.RadioButton',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('folder-music-symbolic');
        Gst.init(null, 0);
        RadioPipe = new Gst.parse_launch('playbin');
        this._appSys = Shell.AppSystem.get_default();
        this._installedChangedId = this._appSys.connect('installed-changed', Lang.bind(this, this._refresh));
        this._display();
    },

    destroy: function() {
        this._appSys.disconnect(this._installedChangedId);
        this.parent();
    },

    _refresh: function() {
        this._clearAll();
        this._display();
    },

    _clearAll: function() {
        this.menu.removeAll();
    },

    _loadCategory: function(category, menu) {
        var radios = RadioUrls[category];
        for (var k in radios) {
            menu.addMenuItem(new RadioMenuItem(k, radios[k]));
        }
    },

    _display : function() {
        RadioPlay = new PlayMenuItem();
        this.menu.addMenuItem(RadioPlay);
        for (var category in RadioUrls) {
            let item = new PopupMenu.PopupSubMenuMenuItem(category);
            this._loadCategory(category, item.menu);
            this.menu.addMenuItem(item);
        }
    }
});

function enable() {
    appsMenuButton = new RadioButton();
    Main.panel.addToStatusArea('radio-player', appsMenuButton, 1, 'right');
}

function disable() {
    appsMenuButton.destroy();
}

function init() {
    initTranslations();
}
