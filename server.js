/**
 * ### cyzon's berrytube/irc bridge ###
 *
 * Available at https://github.com/berrytube/bt-irc-client
 *
 * Disclaimer
 *  - I take no responsibility for anything bad that happens if you use this.  Use at your own risk.
 *
 * Enjoy!  Feel free to report bugs/suggestions
 * -cyzon
 */

var net = require('net');
var fs = require('fs');

// Config
var VERSION = '1.0.13';
var HOSTNAME = 'localhost';
var CONFIG = {
    yay_color: true,
    rcv_color: true,
    rcv_bold: true,
    drink_bold: true,
    request_color: true,
    poll_bold: true,
    show_bold: true,
    show_underline: true,
    strip_html: true,
    echo: false,
    hide_spoilers: true,
    server: 'berrytube.tv:8344'
};

function saveConfig() {
    fs.writeFileSync('options.json', JSON.stringify(CONFIG, null, 4));
}

function loadConfig() {
    try {
        var json = JSON.parse(fs.readFileSync('options.json')+'');
        for (var key in json) {
            if (key in CONFIG) {
                CONFIG[key] = json[key];
            }
        }
    } catch (e) {

    }
}

function testIfSupportsIPv6(port, cb) {
    var test = net.createServer();
    test.on("error", function () {
        test.close();
        cb(false);
    });

    test.listen(port, "::", function () {
        test.close();
        cb(true);
    });
}

function formatVideoLink(video) {
    switch (video.videotype) {
        case "yt":
            return "https://youtu.be/" + video.videoid;
        case "vimeo":
            return "https://vimeo.com/" + video.videoid;
        case "soundcloud":
            return video.meta.permalink;
        default:
            return video.videotype + " - " + video.videoid;
    }
}

function IRCServer(port) {
    var self = this;
    this.clients = [];
    this.irc = net.createServer(function (c) {
        self.newClient(c);
    });
    testIfSupportsIPv6(port, function (supported) {
        if (supported) {
            self.irc.listen(port, "::", function () {
                console.log('Listening on port %d (dual-stack)', port);
            });
        } else {
            self.irc.listen(port, function () {
                console.log('Listening on port %d (IPv4 only)', port);
            });
        }
    });
}

IRCServer.prototype.newClient = function (socket) {
    var self = this;
    console.log('Accepted connection from ' + socket.remoteAddress);
    var c = new Client(socket);
    socket.on('end', function () {
        console.log(c.ip, 'disconnected');
    });
};

function Client(socket) {
    var self = this;
    this.ip = socket.remoteAddress;
    this.name = 'anonymous';
    this.loggedIn = false;
    this.inChannel = false;
    this.poll = null;
    this.lastPoll = null;
    this.socket = socket;
    this.buffer = '';
    this.topic = '';

    socket.on('data', function (data) {
        self.buffer += data;
        if (self.buffer.indexOf('\r\n') !== -1) {
            self.handleBuffer();
        }
    });

    var _socketwrite = socket.write;
    socket.write = function (what) {
        console.log(self.ip + ' <-- ', what.replace(/[\r\n]/g, ''));
        try {
            _socketwrite.call(socket, what);
        } catch (e) {
            console.log(e);
        }
    };

    // BerryTube data
    this.btnicks = [];
    this.initBerrytube();

    socket.on('end', function () {
        self.bt.disconnect(true);
    });
}

Client.prototype.initBerrytube = function () {
    var self = this;
    try {
        self.bt.socket.disconnect(true);
    } catch (e) {
    }
    var client = require('socket.io-client');
    client.util.oldreq = client.util.request;
    client.util.request = function(xdomain){
        var xhr = client.util.oldreq(xdomain);
        xhr.addEventListener('readystatechange', function setBridgeUA() {
            if (xhr.readyState == xhr.OPENED){
                xhr.setRequestHeader('User-Agent', 'bt-irc-bridge');
                xhr.removeEventListener('readystatechange', setBridgeUA);
            }
        });
        return xhr;
    };
    this.bt = client.connect(CONFIG.server, {
        'force new connection': true
    });
    this.bt.on('newChatList', function (data) {
        self.btnicks = data;
        self.btnicks.forEach(function (u) {
            u.ircnick = u.nick + '!' + u.nick + '@berrytube.tv';
        });
        self.btnicks.sort(function (a, b) {
            var x = a.nick.toLowerCase();
            var y = b.nick.toLowerCase();

            var z = a.type - b.type;
            if (z !== 0) {
                return -z;
            }

            return x > y ? 1 : -1;
        });
        self.handleNAMES(null, ['#berrytube']);
    });
    this.bt.on('userJoin', function (data) {
        data.ircnick = data.nick + '!' + data.nick + '@berrytube.tv';
        self.btnicks.push(data);
        self.btnicks.sort(function (a, b) {
            var x = a.nick.toLowerCase();
            var y = b.nick.toLowerCase();

            var z = a.type - b.type;
            if (z !== 0) {
                return -z;
            }

            return x > y ? 1 : -1;
        });
        if (data.nick === self.name) {
            return;
        }
        self.socket.write(':' + data.ircnick + ' JOIN #berrytube\r\n');
        self.handleSetType(data.nick, data.type);
    });
    this.bt.on('userPart', function (data) {
        data.ircnick = data.nick + '!' + data.nick + '@berrytube.tv';
        var found = false;
        for (var i = 0; i < self.btnicks.length; i++) {
            if (self.btnicks[i].nick === data.nick) {
                found = i;
                break;
            }
        }

        if (found !== false) {
            self.btnicks.splice(found, 1);
        }
        self.socket.write(':' + data.ircnick + ' PART #berrytube\r\n');
    });
    this.bt.on('setNick', function (nick) {
        self.socket.write(':' + self.name + ' NICK ' + nick + '\r\n');
        self.name = nick;
        self.loggedIn = true;
    });
    this.bt.on('setType', function (type) {
        if (self.loggedIn) {
            self.handleSetType(self.name, type);
        }
    });
    this.bt.on('chatMsg', function (data) {
        if (data.nick !== self.name) {
            self.handleBTMessage(data);
        }
    });
    this.bt.on('forceVideoChange', function (data) {
        self.topic = 'Now Playing: ' + decodeURIComponent(data.video.videotitle) +
                ' ( ' + formatVideoLink(data.video) + ' )';
        self.socket.write(':BerryTube!BerryTube@berrytube.tv TOPIC #berrytube :' + self.topic + '\r\n');
    });
    this.bt.on('createPlayer', function (data) {
        /* createPlayer should only be fired once
           if createPlayer is fired after the user JOINS the channels we still
           can send RPL_TOPIC instead of TOPIC, because the topic was empty and
           JOIN didn't create a RPL_TOPIC message */
         self.topic = 'Now Playing: ' + decodeURIComponent(data.video.videotitle) +
                ' ( ' + formatVideoLink(data.video) + ' )';
         self.rpl('332 {nick} #berrytube :' + self.topic);
    });
    this.bt.on('kicked', function (reason) {
        self.socket.write(':' + HOSTNAME + ' PRIVMSG ' + self.name + ' :Kicked: ' + reason + '\r\n');
    });
    this.bt.on('newPoll', function (data) {
        self.handleBTPoll(data);
    });
    this.bt.on('updatePoll', function (data) {
        self.handleBTPollUpdate(data);
    });
    this.bt.on('clearPoll', function (data) {
        self.handleBTPollUpdate(data);
        self.lastPoll = self.poll;
        self.poll = null;
    });
    this.bt.on('disconnect', function () {
        self.socket.write(':' + HOSTNAME + ' PRIVMSG ' + self.name + ' :Disconnected from BerryTube\r\n');
        if (self.loggedIn) {
            self.loggedIn = false;
            self.socket.write(':' + self.name + ' NICK anonymous\r\n');
            self.name = 'anonymous';
        }
    });
    this.bt.emit('myPlaylistIsInited');
};

Client.prototype.rpl = function (msg) {
    msg = msg.replace(/\{nick\}/g, this.name);
    msg = ':' + HOSTNAME + ' ' + msg + '\r\n';
    try {
        this.socket.write(msg);
    } catch (e) {
        console.log(e);
    }
};

Client.prototype.handleBuffer = function () {
    var msgs = this.buffer.split('\r\n');
    this.buffer = msgs[msgs.length - 1];
    msgs.length -= 1;
    for (var i = 0; i < msgs.length; i++) {
        console.log(this.ip + ' --> ',msgs[i]);
        var cmd = '', prefix = null, args = msgs[i].split(' ');
        if (msgs[i].indexOf(':') === 0) {
            prefix = args[0].substring(1);
            cmd = args[1];
            args.shift();
            args.shift();
        } else {
            cmd = args[0];
            args.shift();
        }

        this.handleCommand(prefix, cmd, args);
    }
};

Client.prototype.handleCommand = function (prefix, cmd, args) {
    switch (cmd) {
        case 'NICK':
            this.handleNICK(prefix, args);
            break;
        case 'USER':
            this.handleUSER(prefix, args);
            break;
        case 'JOIN':
            this.handleJOIN(prefix, args);
            break;
        case 'PING':
            this.rpl('PONG ' + HOSTNAME + ' :' + HOSTNAME);
            break;
        case 'WHO':
            this.handleWHO(prefix, args);
            break;
        case 'NAMES':
            this.handleNAMES(prefix, args);
            break;
        case 'MODE':
            this.handleMODE(prefix, args);
            break;
        case 'PRIVMSG':
            this.handlePRIVMSG(prefix, args);
            break;
        case 'VERSION':
            this.handleVERSION(prefix, args);
            break;
        case 'QUIT':
            try {
                this.socket.end();
            } catch (e) {
                console.log(e);
            }
            break;
        default:
            break;
    }
};

Client.prototype.handleNICK = function (prefix, args) {
    if (this.inChannel) {
        if (args[0][0] === ':') {
            args[0] = args[0].substring(1);
        }
        this.bt.emit('setNick', {
            nick: args[0],
            pass: false
        });
    } else if (!this.inChannel) {
        this.socket.write(':' + args[0] + ' NICK anonymous\r\n');
        this.handleJOIN(prefix,  ['#berrytube']);
        this.inChannel = true;
    }
};

Client.prototype.handleUSER = function (prefix, args) {
    this.rpl('001 {nick} :Welcome to BerryTube');
    this.handleVERSION(null, []);
    this.rpl('375 {nick} :IRC Bridge by cyzon');
    // Pidgin is the only IRC client that will break if this is not sent.
    this.rpl('376 {nick} :End of MOTD');
};

const PREFIXES = {
    2: '@',
    1: '%',
    0: '+'
};

Client.prototype.handleWHO = function (prefix, args) {
    if (args[0] === '#berrytube') {
        var nicks = Array.prototype.slice.call(this.btnicks);
        if (this.name === 'anonymous') {
            nicks.unshift({
                nick: 'anonymous',
                type: -1
            });
        }
        for (var i = 0; i < nicks.length; i++) {
            var u = nicks[i];
            this.rpl('352 {nick} ' + [
                '#berrytube',
                u.nick,
                'berrytube.tv',
                HOSTNAME,
                u.nick,
                'H' + (PREFIXES[u.type] || ''),
                ':0',
                u.nick
            ].join(' '));
        }
        this.rpl('315 {nick} :End of /WHO list');
    }
};

Client.prototype.handleNAMES = function (prefix, args) {
    if (args[0] === '#berrytube') {
        var names = [];
        if (this.name === 'anonymous') {
            names.push('anonymous');
        }

        for (var i = 0; i < this.btnicks.length; i++) {
            var pre = PREFIXES[this.btnicks[i].type] || '';
            names.push(pre + this.btnicks[i].nick);
        }

        var msg = ':' + HOSTNAME + ' 353 ' + this.name + ' = #berrytube :';
        for (var i = 0; i < names.length; i++) {
            if (msg.length + names[i].length + 3 > 512) {
                this.socket.write(msg + '\r\n');
                msg = ':' + HOSTNAME + ' 353 ' + this.name + ' = #berrytube :';
            } else {
                msg += names[i] + ' ';
            }
        }

        if (msg[msg.length - 1] !== ':') {
            this.socket.write(msg + '\r\n');
        }

        this.rpl('366 {nick} #berrytube :End of /NAMES list');
    }
};

Client.prototype.handleMODE = function (prefix, args) {
    if (args[0] === this.name) {
        this.socket.write(':' + HOSTNAME + ' MODE ' + this.name + ' +i\r\n');
    } else if (args[0] === '#berrytube') {
        this.rpl('324 {nick} #berrytube +nt');
    }
};

Client.prototype.handlePRIVMSG = function (prefix, args) {
    switch (args[0]) {
        case 'control': {
            this.handleControl(args);
            break;
        }
        case '#berrytube': {
            if (!this.loggedIn) {
                this.rpl('404 {nick} #berrytube :Cannot send to channel');
                break;
            }
            args.shift();
            if (args[0].indexOf(':') === 0) {
                args[0] = args[0].substring(1);
            }

            var msg = args.join(' ');
            msg = msg.replace(/\x01ACTION(.*?)\x01/, '/me $1');

            this.bt.emit('chat', {
                msg: msg,
                metadata: {
                    channel: 'main',
                    flair: 0
                }
            });
            break;
        }
        default:
            this.rpl('404 {nick} ' + args[0] + ' :Cannot send to channel');
            break;
    }
};

Client.prototype.handleControl = function (args) {
    var cmd = args[1].substring(1);
    args.shift();
    args.shift();
    var self = this;
    var cmsg = function (msg) {
        self.socket.write(':control PRIVMSG ' + self.name + ' :' + msg + '\r\n');
    };
    switch (cmd) {
        case 'login': {
            var pass = false;
            var nick = args[0];
            if (nick === undefined) {
                this.socket.write(':control PRIVMSG ' + this.name + ' :Invalid login details\r\n');
                break;
            }
            if (nick[0] === ':') {
                nick = nick.substring(1);
            }
            if (args.length > 1) {
                pass = args[1];
            }
            this.bt.emit('setNick', {
                nick: nick,
                pass: pass
            });
            break;
        }

        case 'reconnect': {
            this.socket.write(':control PRIVMSG ' + this.name + ' :Attempting to reconnect to berrytube\r\n');
            this.initBerrytube();
            break;
        }

        case 'set': {
            var key = args[0];
            if (key === undefined) {
                this.socket.write(':control PRIVMSG ' + this.name + ' :Available config keys: ' + Object.keys(CONFIG).join(' ') + '\r\n');
                break;
            }

            var val = args[1];
            if (val === '=') {
                val = args[2];
            }

            if (typeof val !== 'string') {
                val = '';
            }

            if (!(key in CONFIG)) {
                this.socket.write(':control PRIVMSG ' + this.name + ' :Unknown config key ' + key + '\r\n');
                break;
            }

            if (val.trim() === '') {
                this.socket.write(':control PRIVMSG ' + this.name + ' :Current value of ' + key + ' = ' + CONFIG[key] + '\r\n');
                break;
            }

            var isBool = (typeof CONFIG[key] === 'boolean');
            if (isBool) {
                val = Boolean(val.match(/^true|1|yes|on$/));
            }

            CONFIG[key] = val;
            saveConfig();
            this.socket.write(':control PRIVMSG ' + this.name + ' :Updated ' + key + ' = ' + val + '\r\n');
            break;
        }

        case 'poll': {
            var showPoll = function (poll) {
                cmsg('Poll (' + poll.title + ')');
                for (var i = 0; i < poll.options.length; i++) {
                    cmsg(i +'.  [' + poll.votes[i] + '] ' + poll.options[i]);
                }
            }

            if (args[0] === undefined) {
                if (this.poll == null) {
                    cmsg('No active poll.  Use /msg control poll last to view results of previous poll');
                } else {
                    showPoll(this.poll);
                }
            } else switch (args[0]) {
                case 'last': {
                    if (this.lastPoll == null) {
                        cmsg('No previous poll recorded');
                    } else {
                        showPoll(this.lastPoll);
                    }
                    break;
                }
                case 'vote': {
                    if (this.poll == null) {
                        cmsg('Cannot vote: no active poll');
                        break;
                    }
                    var opt = parseInt(args[1]);
                    if (isNaN(opt) || opt < 0 || opt >= this.poll.options.length) {
                        cmsg('Invalid poll choice.');
                    } else {
                        this.bt.emit('votePoll', { op: opt });
                        cmsg('Voted for option ' + opt + ': ' + this.poll.options[opt]);
                    }
                    break;
                }
                default: {
                    cmsg('Invalid poll command');
                    break;
                }
            }
            break;
        }
    }
};

Client.prototype.handleVERSION = function (prefix, args) {
    this.rpl('004 {nick} cyzonbridge-'+VERSION+'. '+HOSTNAME+' :');
    this.rpl('005 {nick} PREFIX=(ohv)@%+ :are supported by this server');
};

Client.prototype.handleBTMessage = function (data) {
    var nick = data.msg.nick;
    var msg = data.msg.msg;

    if (CONFIG.yay_color) {
        msg = msg.replace(/<span class="flutter">(.*?)<\/span>/g, '\x0313$1\x03');
    }
    if (CONFIG.show_bold) {
        msg = msg.replace(/<strong>(.*?)<\/strong>/g, '\x02$1\x02');
    }
    if (CONFIG.show_underline) {
        msg = msg.replace(/<em>(.*?)<\/em>/g, '\x1f$1\x1f');
    }
    if (CONFIG.hide_spoilers) {
        msg = msg.replace(/<span class="spoiler">.*?<\/span>/g, '\x02(SPOILER HIDDEN)\x02');
    }

    if (CONFIG.strip_html) {
        msg = msg.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
        msg = msg.replace(/<em>(.*?)<\/em>/g, '_$1_');
        msg = msg.replace(/<strike>(.*?)<\/strike>/g, '~~$1~~');
        msg = msg.replace(/<\/?.*?>(.*?)/g, '$1');
    }

    msg = msg.replace(/&gt;/g, '>');
    msg = msg.replace(/&lt;/g, '<');
    msg = msg.replace(/&amp;/g, '&');

    switch (data.msg.emote) {
        case 'request':
            msg = 'requests ' + msg;
            if (CONFIG.request_color) {
                msg = '\x032' + msg + '\x03';
            }
            msg = '\x01ACTION ' + msg + '\x01';
            break;
        case 'rcv':
            if (CONFIG.rcv_bold) {
                msg = '\x02' + msg + '\x02';
            }

            if (CONFIG.rcv_color) {
                msg = '\x034' + msg + '\x03';
            }
            break;
        case 'drink':
            msg = msg + ' drink!';
            if (data.msg.multi > 1) {
                msg += ' (x' + data.msg.multi + ')';
            }

            if (CONFIG.drink_bold) {
                msg = '\x02' + msg + '\x02';
            }
            break;
        case 'act':
            msg = '\x01ACTION ' + msg + '\x01';
            break;
        case 'spoiler':
            if (CONFIG.hide_spoilers) {
                msg = '\x02(SPOILER HIDDEN)\x02';
            }
            break;
        default:
            break;
    }

    if (nick !== this.name || CONFIG.echo) {
        nick = nick + '!' + nick + '@berrytube.tv';
        this.socket.write(':' + nick + ' PRIVMSG #berrytube :' + msg + '\r\n');
    }
};

Client.prototype.handleBTPoll = function (data) {
    this.poll = data;
    var msg = 'opened poll: ' + data.title;
    if (CONFIG.poll_bold) {
        msg = '\x02' + msg + '\x0f';
    }
    msg = '\x01ACTION ' + msg + '\x01';
    var nick = data.creator + '!' + data.creator + '@berrytube.tv';
    this.socket.write(':' + nick + ' PRIVMSG #berrytube :' + msg + '\r\n');
};

Client.prototype.handleBTPollUpdate = function (data) {
    this.poll.votes = data.votes;
};

Client.prototype.handleSetType = function(nick, type) {
    switch (type) {
        case 2:
            this.socket.write(':' + HOSTNAME + ' MODE #berrytube +o ' + nick + '\r\n');
            break;
        case 1:
            this.socket.write(':' + HOSTNAME + ' MODE #berrytube +h ' + nick + '\r\n');
            break;
        case 0:
            this.socket.write(':' + HOSTNAME + ' MODE #berrytube +v ' + nick + '\r\n');
            break;
        default:
            break;
    }
}

Client.prototype.handleJOIN = function(prefix, args) {
    if (args[0] === '#berrytube') {
        this.socket.write(':' + this.name + ' JOIN #berrytube\r\n');
        
        /* http://tools.ietf.org/html/rfc1459#section-4.2.1
           If a JOIN is successful, the user is then sent the channel's topic
           (using RPL_TOPIC) and the list of users who are on the channel (using
           RPL_NAMREPLY), which must include the user joining. */
        if (this.topic != '') {
            this.rpl('332 {nick} #berrytube :' + this.topic);
        }
        this.handleNAMES(prefix, args);
    } else {
      this.rpl('403 {nick} ' + args[0] + ' :No such channel');
    }
}

process.on('uncaughtException', function (e) {
    console.log(e);
});

var port = process.argv[2];
if (port !== undefined && port.match(/\d+/)) {
    port = parseInt(port);
} else {
    port = 6667;
}

loadConfig();
var s = new IRCServer(port);
// vim: ts=4 sts=4 sw=4
