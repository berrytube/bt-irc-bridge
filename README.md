bt-irc-bridge
=============

This is a utility I (cyzon) wrote to allow IRC clients to connect to BerryTube chat.  It runs as a pseudo-IRC daemon and opens websocket connections to BerryTube, translating messages between the two.

Current Features:
  - View userlist and people joining/leaving
  - View chat and send chat messages
  - View current video title (channel topic)
  - Log in as a guest or registered user
  - View and vote in polls
  - Options for configuring certain messages (like drink calls and RCV) to be bold, colored, etc.
  - Confirmed to work with HexChat, irssi, Weechat, ZNC, and Pidgin (kinda, Pidgin has some issues)
  
### Installation/Running

#### Windows

I have a prepackaged version of node + required modules + bridge available:

  1. Download [bt-irc-portable.zip](http://tirek.cyzon.us/~cyzon/bt/bt-irc-portable.zip)
  2. Extract the downloaded file
  3. Run btircbridge.bat

You can also install the Windows release of node and follow the steps for Linux to install the bridge.

#### Linux

Installing Node:

**NOTE**: If you are using a cutting-edge distribution like Arch which has node v0.10 in its repos, you can use the repo version.  If you are using Ubuntu, Linux Mint, or a similar stable distribution, the version of node in their repos is _ancient_ and won't work.

  1. Download the latest source code from [nodejs.org](http://nodejs.org/)
  2. Extract the `tar.gz` file
  3. Enter the directory and run `./configure`
  4. Run `make` followed by `sudo make install`
  5. Verify that `node -v` outputs something like `v0.10.24` (last number may vary)

Installing the bridge:

  1. Run `git clone https://github.com/berrytube/bt-irc-bridge` (or download the zipball from GitHub and extract it)
  2. `cd bt-irc-bridge`
  3. `npm install socket.io-client`
  4. `node server.js` (Optional: bind a port besides 6667 by running `node server.js <port>`)

### Controls
  - Choose a guest name with `/nick whatever`
  - Login as a regular user with `/msg control login <user> <pass>`
  - Change configuration options with `/msg control set <key> <value>`
  - `/msg control set` lists config keys
  - `/msg control set <key>` shows the current value for <key>
  - View the current poll with `/msg control poll`
  - View the previous poll with `/msg control poll last`
  - Vote in a poll with `/msg control poll vote <option #>`
  - Reconnect to berrytube with `/msg control reconnect`

### Config
  - yay_color: If enabled, use mIRC colors to turn <span class="flutter"> to be pink
  - rcv_color: If enabled, use mIRC colors to make rcv messages red
  - rcv_bold: If enabled, set the bold attribute for rcv messages
  - drink_bold: If enabled, set the bold attribute for drink calls (makes them more visible)
  - request_color: If enabled, use mIRC colors to make requests blue
  - poll_bold: If enabled, poll notification messages are bolded
  - show_bold: If enabled, set the bold attribute for modmin bold messages
  - show\_underline: If enabled, set the underline attribute for italicized messages (\_message\_)
  - strip_html: If enabled, strip HTML tags from messages
  - echo: If enabled, echo back messages sent to berrytube.
    By default, when you send a message from IRC, it is displayed
    plain (unfiltered) in your IRC client. I cannot fix this
    with anything I do serverside, so by default messages
    from berrytube from your nickname are ignored
    because showing them would duplicate messages.
    You can override this by setting echo to true
  - hide_spoilers: If enabled, replace spoiler messages with [SPOILER]. Enabled by default.
