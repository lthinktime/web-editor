window.LOCAL_URL = '/'; // http://localhost:17310/';
window.LOCAL_VERSION = '0.0.3'


window.vm = new Vue({
  el: '#app',
  data: {
    deviceId: '', // deviceId is generated by server side which is a very long string
    console: {
      content: '',
    },
    error: '',
    codeRunning: false,
    wsBuild: null,
    generatedCode: '',
    editor: null,
    cursor: {},
    showCursorPercent: true,
    nodeSelected: null,
    nodeHovered: null,
    nodeHoveredList: [],
    originNodeMaps: {},
    originNodes: [],
    autoCopy: true,
    platform: localStorage.platform || 'Android',
    serial: localStorage.serial || '',
    imagePool: null,
    loading: false,
    canvas: {
      bg: null,
      fg: null,
    },
    canvasStyle: {
      opacity: 0.5,
      width: 'inherit',
      height: 'inherit'
    },
    lastScreenSize: {
      screen: {},
      canvas: {
        width: 1,
        height: 1
      }
    },
    tabActiveName: "console",
    mapAttrCount: {},
  },
  watch: {
    platform: function (newval) {
      localStorage.setItem('platform', newval);
    },
    serial: function (newval) {
      localStorage.setItem('serial', newval);
    }
  },
  computed: {
    cursorValue: function () {
      if (this.showCursorPercent) {
        return { x: this.cursor.px, y: this.cursor.py }
      } else {
        return this.cursor
      }
    },
    nodes: function () {
      return this.originNodes
    },
    elem: function () {
      return this.nodeSelected || {};
    },
    elemXPathLite: function () {
      // scan nodes
      this.mapAttrCount = {}
      this.nodes.forEach((n) => {
        this.incrAttrCount("resourceId", n.resourceId)
        this.incrAttrCount("text", n.text)
        this.incrAttrCount("className", n.className)
        this.incrAttrCount("description", n.description)
      })

      let node = this.elem;
      const array = [];
      while (node && node._parentId) {
        const parent = this.originNodeMaps[node._parentId]
        if (this.getAttrCount("resourceId", node.resourceId) === 1) {
          array.push(`*[@resource-id="${node.resourceId}"]`)
          break
        } else if (this.getAttrCount("text", node.text) === 1) {
          array.push(`*[@text="${node.text}"]`)
          break
        } else if (this.getAttrCount("description", node.description) === 1) {
          array.push(`*[@content-desc="${node.description}"]`)
          break
        } else if (this.getAttrCount("className", node.className) === 1) {
          array.push(`${node.className}`)
          break
        } else if (!parent) {
          array.push(`${node.className}`)
        } else {
          let index = 0;
          parent.children.some((n) => {
            if (n.className == node.className) {
              index++
            }
            return n._id == node._id
          })
          array.push(`${node.className}[${index}]`)
        }
        node = parent;
      }
      return `//${array.reverse().join("/")}`
    },
    elemXPathFull: function () {
      let node = this.elem;
      const array = [];
      while (node && node._parentId) {
        let parent = this.originNodeMaps[node._parentId];

        let index = 0;
        parent.children.some((n) => {
          if (n.className == node.className) {
            index++
          }
          return n._id == node._id
        })

        array.push(`${node.className}[${index}]`)
        node = parent;
      }
      return `//${array.reverse().join("/")}`
    },
    deviceUrl: function () {
      if (this.platform == 'Android' && this.serial == '') {
        return '';
      }
      if (this.platform == 'iOS' && this.serial == '') {
        return 'http://localhost:8100';
      }
      if (this.platform == 'Neco') {
        var ipex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b:?\d*/;
        var t = this.serial.match(ipex);
        return t ? t[0] : '';
      }
      return this.serial;
    }
  },
  created: function () {
    this.imagePool = new ImagePool(100);
  },
  mounted: function () {
    var URL = window.URL || window.webkitURL;
    var currentSize = null;
    var self = this;

    this.canvas.bg = document.getElementById('bgCanvas')
    this.canvas.fg = document.getElementById('fgCanvas')
    // this.canvas = c;
    window.c = this.canvas.bg;
    var ctx = c.getContext('2d')

    $(window).resize(function () {
      self.resizeScreen();
    })

    // initial select platform
    $('.selectpicker').selectpicker('val', this.platform);

    this.initJstree();

    var editor = this.editor = ace.edit("editor");
    editor.resize()
    window.editor = editor;
    this.initEditor(editor);
    this.initDragDealer();

    this.activeMouseControl();

    function setError(msg) {
      self.error = msg;
      self.loading = false;
    }

    this.loading = true;
    this.checkVersion()

    // this.screenRefresh()
    // this.loadLiveScreen();
  },
  methods: {
    checkVersion: function () {
      var self = this;
      $.ajax({
        url: LOCAL_URL + "api/v1/version",
        type: "GET",
      })
        .done(function (ret) {
          console.log("version", ret.name);

          var lastScreenshotBase64 = localStorage.screenshotBase64;
          if (lastScreenshotBase64) {
            var blob = b64toBlob(lastScreenshotBase64, 'image/jpeg');
            self.drawBlobImageToScreen(blob);
            self.canvasStyle.opacity = 1.0;
          }
          if (localStorage.windowHierarchy) {
            // self.originNodes = JSON.parse(localStorage.windowHierarchy);
            var source = JSON.parse(localStorage.windowHierarchy);
            self.drawAllNodeFromSource(source);
            self.loading = false;
            self.canvasStyle.opacity = 1.0;
          }
        })
        .fail(function (ret) {
          self.showError("<p>Local server not started, start with</p><pre>$ python -m weditor</pre>");
        })
        .always(function () {
          self.loading = false;
        })
    },
    getAttrCount(collectionKey, key) {
      // eg: getAttrCount("resource-id", "tv_scan_text")
      let mapCount = this.mapAttrCount[collectionKey];
      if (!mapCount) {
        return 0
      }
      return mapCount[key] || 0;
    },
    incrAttrCount(collectionKey, key) {
      if (!this.mapAttrCount.hasOwnProperty(collectionKey)) {
        this.mapAttrCount[collectionKey] = {}
      }
      let count = this.mapAttrCount[collectionKey][key] || 0;
      this.mapAttrCount[collectionKey][key] = count + 1;
    },
    doConnect: function () {
      var lastDeviceId = this.deviceId;
      this.deviceId = '';
      return $.ajax({
        url: LOCAL_URL + "api/v1/connect",
        method: 'POST',
        data: {
          platform: this.platform,
          deviceUrl: this.deviceUrl,
        },
      })
        .then((ret) => {
          console.log("deviceId", ret.deviceId)
          this.deviceId = ret.deviceId
        })
        .fail((ret) => {
          this.showAjaxError(ret);
          this.deviceId = lastDeviceId;
        })
    },
    keyevent: function (meta) {
      var code = 'd.press("' + meta + '")'
      if (this.platform != 'Android' && meta == 'home') {
        code = 'd.home()'
      }
      return this.codeRunDebugCode(code)
        .then(function () {
          return this.codeInsert(code);
        }.bind(this))
        .then(this.delayReload)
    },
    sourceToJstree: function (source) {
      var n = {}
      n.id = source._id;
      n.text = source.type || source.className
      if (source.name) {
        n.text += " - " + source.name;
      }
      if (source.resourceId) {
        n.text += " - " + source.resourceId;
      }
      n.icon = this.sourceTypeIcon(source.type);
      if (source.children) {
        n.children = []
        source.children.forEach(function (s) {
          n.children.push(this.sourceToJstree(s))
        }.bind(this))
      }
      return n;
    },
    sourceTypeIcon: function (widgetType) {
      switch (widgetType) {
        case "Scene":
          return "glyphicon glyphicon-tree-conifer"
        case "Layer":
          return "glyphicon glyphicon-equalizer"
        case "Camera":
          return "glyphicon glyphicon-facetime-video"
        case "Node":
          return "glyphicon glyphicon-leaf"
        case "ImageView":
          return "glyphicon glyphicon-picture"
        case "Button":
          return "glyphicon glyphicon-inbox"
        case "Layout":
          return "glyphicon glyphicon-tasks"
        case "Text":
          return "glyphicon glyphicon-text-size"
        default:
          return "glyphicon glyphicon-object-align-horizontal"
      }
    },
    showError: function (error) {
      this.loading = false;
      this.error = error;
      $('.modal').modal('show');
    },
    showAjaxError: function (ret) {
      if (ret.responseJSON && ret.responseJSON.description) {
        this.showError(ret.responseJSON.description);
      } else {
        this.showError("<p>Local server not started, start with</p><pre>$ python -m weditor</pre>");
      }
    },
    initJstree: function () {
      var $jstree = $("#jstree-hierarchy");
      this.$jstree = $jstree;
      var self = this;
      $jstree.jstree({
        plugins: ["search"],
        core: {
          multiple: false,
          themes: {
            "variant": "small"
          },
          data: []
        }
      })
        .on('ready.jstree refresh.jstree', function () {
          $jstree.jstree("open_all");
        })
        .on("changed.jstree", function (e, data) {
          var id = data.selected[0];
          var node = self.originNodeMaps[id];
          if (node) {
            self.nodeSelected = node;
            self.drawAllNode();
            self.drawNode(node, "red");
            var generatedCode = self.generateNodeSelectorCode(self.nodeSelected);
            if (self.autoCopy) {
              copyToClipboard(generatedCode);
            }
            self.generatedCode = generatedCode;
          }
        })
        .on("hover_node.jstree", function (e, data) {
          var node = self.originNodeMaps[data.node.id];
          if (node) {
            self.nodeHovered = node;
            self.drawRefresh()
          }
        })
        .on("dehover_node.jstree", function () {
          self.nodeHovered = null;
          self.drawRefresh()
        })
      $("#jstree-search").on('propertychange input', function (e) {
        var ret = $jstree.jstree(true).search($(this).val());
      })
    },
    initDragDealer: function () {
      var self = this;
      var updateFunc = null;

      function dragMoveListener(evt) {
        evt.preventDefault();
        updateFunc(evt);
        self.resizeScreen();
        self.editor.resize();
      }

      function dragStopListener(evt) {
        document.removeEventListener('mousemove', dragMoveListener);
        document.removeEventListener('mouseup', dragStopListener);
        document.removeEventListener('mouseleave', dragStopListener);
      }

      $('#vertical-gap1').mousedown(function (e) {
        e.preventDefault();
        updateFunc = function (evt) {
          $("#left").width(evt.clientX);
        }
        document.addEventListener('mousemove', dragMoveListener);
        document.addEventListener('mouseup', dragStopListener);
        document.addEventListener('mouseleave', dragStopListener)
      });

      $('.horizon-gap').mousedown(function (e) {
        updateFunc = function (evt) {
          var $el = $("#console");
          var y = evt.clientY;
          $el.height($(window).height() - y)
        }

        document.addEventListener('mousemove', dragMoveListener);
        document.addEventListener('mouseup', dragStopListener);
        document.addEventListener('mouseleave', dragStopListener)
      })
    },
    initEditor: function (editor) {
      var self = this;
      editor.getSession().setMode("ace/mode/python");
      editor.getSession().setUseSoftTabs(true);
      editor.getSession().setUseWrapMode(true);

      // auto save
      editor.insert(localStorage.getItem("code") || "")
      editor.on("change", function (e) {
        localStorage.setItem("code", editor.getValue())
      })

      editor.commands.addCommands([{
        name: 'build',
        bindKey: {
          win: 'Ctrl-B',
          mac: 'Command-B'
        },
        exec: function (editor) {
          self.codeRunDebugCode(editor.getValue())
        },
      }, {
        name: 'build',
        bindKey: {
          win: 'Ctrl-Enter',
          mac: 'Command-Enter'
        },
        exec: function (editor) {
          self.codeRunDebugCode(editor.getValue())
        },
      }, {
        name: "build-inline",
        bindKey: {
          win: "Ctrl-Shift-Enter",
          mac: "Command-Shift-Enter",
        },
        exec: function (editor) {
          let code = editor.getSelectedText()
          if (!code) {
            let row = editor.getCursorPosition().row;
            code = editor.getSession().getLine(row);
          }
          self.codeRunDebugCode(code)
        }
      }]);

      // editor.setReadOnly(true);
      // editor.setHighlightActiveLine(false);
      editor.$blockScrolling = Infinity;
    },
    resizeScreen: function (img) {
      // check if need update
      if (img) {
        if (this.lastScreenSize.canvas.width == img.width &&
          this.lastScreenSize.canvas.height == img.height) {
          return;
        }
      } else {
        img = this.lastScreenSize.canvas;
        if (!img) {
          return;
        }
      }
      var screenDiv = document.getElementById('screen');
      this.lastScreenSize = {
        canvas: {
          width: img.width,
          height: img.height
        },
        screen: {
          width: screenDiv.clientWidth,
          height: screenDiv.clientHeight,
        }
      }
      var canvasRatio = img.width / img.height;
      var screenRatio = screenDiv.clientWidth / screenDiv.clientHeight;
      if (canvasRatio > screenRatio) {
        Object.assign(this.canvasStyle, {
          width: Math.floor(screenDiv.clientWidth) + 'px', //'100%',
          height: Math.floor(screenDiv.clientWidth / canvasRatio) + 'px', // 'inherit',
        })
      } else {
        Object.assign(this.canvasStyle, {
          width: Math.floor(screenDiv.clientHeight * canvasRatio) + 'px', //'inherit',
          height: Math.floor(screenDiv.clientHeight) + 'px', //'100%',
        })
      }
    },
    delayReload: function (msec) {
      setTimeout(this.screenDumpUI, msec || 1000);
    },
    screenDumpUI: function () {
      var self = this;
      this.loading = true;
      this.canvasStyle.opacity = 0.5;

      if (!this.deviceId) {
        return this.doConnect().then(this.screenDumpUI)
      } else {
        return this.screenRefresh()
          .fail(function (ret) {
            self.showAjaxError(ret);
          })
          .then(function () {
            return $.getJSON(LOCAL_URL + 'api/v1/devices/' + encodeURIComponent(self.deviceId || '-') + '/hierarchy')
          })
          .fail(function (ret) {
            self.showAjaxError(ret);
          })
          .then(function (source) {
            localStorage.setItem('windowHierarchy', JSON.stringify(source));
            self.drawAllNodeFromSource(source);
          })
      }
    },
    screenRefresh: function () {
      return $.getJSON(LOCAL_URL + 'api/v1/devices/' + encodeURIComponent(this.deviceId || '-') + '/screenshot')
        .then(function (ret) {
          var blob = b64toBlob(ret.data, 'image/' + ret.type);
          this.drawBlobImageToScreen(blob);
          localStorage.setItem('screenshotBase64', ret.data);
        }.bind(this))
    },
    drawBlobImageToScreen: function (blob) {
      // Support jQuery Promise
      var dtd = $.Deferred();
      var bgcanvas = this.canvas.bg,
        fgcanvas = this.canvas.fg,
        ctx = bgcanvas.getContext('2d'),
        self = this,
        URL = window.URL || window.webkitURL,
        BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
        img = this.imagePool.next();

      img.onload = function () {
        fgcanvas.width = bgcanvas.width = img.width
        fgcanvas.height = bgcanvas.height = img.height


        ctx.drawImage(img, 0, 0, img.width, img.height);
        self.resizeScreen(img);

        // Try to forcefully clean everything to get rid of memory
        // leaks. Note self despite this effort, Chrome will still
        // leak huge amounts of memory when the developer tools are
        // open, probably to save the resources for inspection. When
        // the developer tools are closed no memory is leaked.
        img.onload = img.onerror = null
        img.src = BLANK_IMG
        img = null
        blob = null

        URL.revokeObjectURL(url)
        url = null
        dtd.resolve();
      }

      img.onerror = function () {
        // Happily ignore. I suppose this shouldn't happen, but
        // sometimes it does, presumably when we're loading images
        // too quickly.

        // Do the same cleanup here as in onload.
        img.onload = img.onerror = null
        img.src = BLANK_IMG
        img = null
        blob = null

        URL.revokeObjectURL(url)
        url = null
        dtd.reject();
      }
      var url = URL.createObjectURL(blob)
      img.src = url;
      return dtd;
    },
    loadLiveScreen: function () {
      var self = this;
      var BLANK_IMG =
        'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
      var protocol = location.protocol == "http:" ? "ws://" : "wss://"
      var ws = new WebSocket('ws://10.240.184.233:9002');
      var canvas = document.getElementById('bgCanvas')
      var ctx = canvas.getContext('2d');
      var lastScreenSize = {
        screen: {},
        canvas: {}
      };

      ws.onopen = function (ev) {
        console.log('screen websocket connected')
      };
      ws.onmessage = function (message) {
        console.log("New message");
        var blob = new Blob([message.data], {
          type: 'image/jpeg'
        })
        var img = self.imagePool.next();
        img.onload = function () {
          canvas.width = img.width
          canvas.height = img.height
          ctx.drawImage(img, 0, 0, img.width, img.height);
          self.resizeScreen(img);

          // Try to forcefully clean everything to get rid of memory
          // leaks. Note self despite this effort, Chrome will still
          // leak huge amounts of memory when the developer tools are
          // open, probably to save the resources for inspection. When
          // the developer tools are closed no memory is leaked.
          img.onload = img.onerror = null
          img.src = BLANK_IMG
          img = null
          blob = null

          URL.revokeObjectURL(url)
          url = null
        }

        img.onerror = function () {
          // Happily ignore. I suppose this shouldn't happen, but
          // sometimes it does, presumably when we're loading images
          // too quickly.

          // Do the same cleanup here as in onload.
          img.onload = img.onerror = null
          img.src = BLANK_IMG
          img = null
          blob = null

          URL.revokeObjectURL(url)
          url = null
        }
        var url = URL.createObjectURL(blob)
        img.src = url;
      }

      ws.onclose = function (ev) {
        console.log("screen websocket closed")
      }
    },
    codeRunDebugCode: function (code) {
      this.codeRunning = true;
      this.tabActiveName = "console";
      if (!this.deviceId) {
        return this.doConnect().then(() => {
          this.codeRunDebugCode(code)
        })
      }
      return $.ajax({
        method: 'post',
        url: LOCAL_URL + 'api/v1/devices/' + this.deviceId + '/exec',
        data: {
          code: code
        }
      })
        .then(function (ret) {
          this.console.content = ret.content;
          this.console.content += '[Finished in ' + ret.duration / 1000 + 's]'
        }.bind(this))
        .always(function () {
          this.codeRunning = false;
        }.bind(this))
      // return this.codeRunDebug(codeSample);
    },
    codeInsertPrepare: function (line) {
      if (/if $/.test(line)) {
        return;
      }
      if (/if$/.test(line)) {
        this.editor.insert(' ');
        return;
      }
      if (line.trimLeft()) {
        // editor.session.getLine(editor.getCursorPosition().row)
        var indent = editor.session.getMode().getNextLineIndent("start", line, "    ");
        this.editor.navigateLineEnd();
        this.editor.insert("\n" + indent); // BUG(ssx): It does't work the first time.
        return;
      }
    },
    codeInsert: function (code) {
      var editor = this.editor;
      var currentLine = editor.session.getLine(editor.getCursorPosition().row);
      this.codeInsertPrepare(currentLine);
      editor.insert(code);
      editor.scrollToRow(editor.getCursorPosition().row); // update cursor position
    },
    findNodes: function (kwargs) {
      return this.nodes.filter((node) => {
        for (const [k, v] of Object.entries(kwargs)) {
          if (node[k] !== v) {
            return false;
          }
        }
        return true
      })
    },
    generatePythonCode: function (code) {
      return ['# coding: utf-8', 'import atx', 'd = atx.connect()', code].join('\n');
    },
    doSendKeys: function (text) {
      if (!text) {
        text = window.prompt("Input text?")
      }
      if (!text) {
        return;
      }
      const code = `d.send_keys("${text}", clear=True)`
      this.loading = true;
      this.codeInsert(code);
      this.codeRunDebugCode(code)
        .then(this.delayReload)
    },
    doClear: function () {
      var code = 'd.clear_text()'
      this.codeRunDebugCode(code)
        .then(this.delayReload)
        .then(function () {
          return this.codeInsert(code);
        }.bind(this))
    },
    doTap: function (node) {
      var self = this;
      var code = this.generateNodeSelectorCode(node);
      // FIXME(ssx): put into a standalone function
      code += ".click()"
      self.codeInsert(code);

      this.loading = true;
      this.codeRunDebugCode(code)
        .then(function () {
          self.delayReload();
        })
        .fail(function () {
          self.loading = false;
        })
    },
    doPositionTap: function (x, y) {
      var code = 'd.click(' + x + ', ' + y + ')'
      this.codeInsert(code);
      this.codeRunDebugCode(code)
        .then(this.delayReload)
    },
    generateNodeSelectorKwargs: function (node) {
      // iOS: name, label, className
      // Android: text, description, resourceId, className
      let kwargs = {};
      ['label', 'resourceId', 'name', 'text', 'type', 'tag', 'description', 'className'].some((key) => {
        if (!node[key]) {
          return false;
        }
        kwargs[key] = node[key];
        return this.findNodes(kwargs).length === 1
      });

      const matchedNodes = this.findNodes(kwargs);
      const nodeCount = matchedNodes.length
      if (nodeCount > 1) {
        kwargs['instance'] = matchedNodes.findIndex((n) => {
          return n._id == node._id
        })
      }
      kwargs["_count"] = nodeCount
      return kwargs;
    },
    _combineKeyValue(key, value) {
      if (typeof value === "string") {
        value = `"${value}"`
      }
      return key + '=' + value;
    },
    generateNodeSelectorCode: function (node) {
      let kwargs = this.generateNodeSelectorKwargs(node)
      if (kwargs._count === 1) {
        const array = [];
        for (const [key, value] of Object.entries(kwargs)) {
          if (key.startsWith("_")) {
            continue;
          }
          array.push(this._combineKeyValue(key, value))
        }
        return `d(${array.join(", ")})`
      }
      return `d.xpath('${this.elemXPathLite}')`
    },
    drawAllNodeFromSource: function (source) {
      let jstreeData = this.sourceToJstree(source);
      let jstree = this.$jstree.jstree(true);
      jstree.settings.core.data = jstreeData;
      jstree.refresh();

      let nodeMaps = this.originNodeMaps = {}

      function sourceToNodes(source) {
        let node = Object.assign({}, source); //, { children: undefined });
        nodeMaps[node._id] = node;
        let nodes = [node];
        if (source.children) {
          source.children.forEach(function (s) {
            s._parentId = node._id;
            nodes = nodes.concat(sourceToNodes(s))
          })
        }
        return nodes;
      }
      this.originNodes = sourceToNodes(source) //ret.nodes;
      this.drawAllNode();
      this.loading = false;
      this.canvasStyle.opacity = 1.0;
    },
    drawRefresh: function () {
      this.drawAllNode()
      if (this.nodeSelected) {
        this.drawNode(this.nodeSelected, "red")
      }
      if (this.nodeHovered) {
        this.drawNode(this.nodeHovered, "blue")
      }
    },
    drawAllNode: function () {
      var self = this;
      var canvas = self.canvas.fg;
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      self.nodes.forEach(function (node) {
        // ignore some types
        if (['Layout'].includes(node.type)) {
          return;
        }
        self.drawNode(node, 'black', true);
      })
    },
    drawNode: function (node, color, dashed) {
      if (!node || !node.rect) {
        return;
      }
      var x = node.rect.x,
        y = node.rect.y,
        w = node.rect.width,
        h = node.rect.height;
      color = color || 'black';
      var ctx = this.canvas.fg.getContext('2d');
      var rectangle = new Path2D();
      rectangle.rect(x, y, w, h);
      if (dashed) {
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 10]);
      } else {
        ctx.lineWidth = 5;
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = color;
      ctx.stroke(rectangle);
    },
    findNodesByPosition(pos) {
      function isInside(node, x, y) {
        if (!node.rect) {
          return false;
        }
        var lx = node.rect.x,
          ly = node.rect.y,
          rx = node.rect.width + lx,
          ry = node.rect.height + ly;
        return lx < x && x < rx && ly < y && y < ry;
      }

      function nodeArea(node) {
        return node.rect.width * node.rect.height;
      }

      let activeNodes = this.nodes.filter(function (node) {
        if (!isInside(node, pos.x, pos.y)) {
          return false;
        }
        // skip some types
        if (['Layout', 'Sprite'].includes(node.type)) {
          return false;
        }
        return true;
      })

      activeNodes.sort((node1, node2) => {
        return nodeArea(node1) - nodeArea(node2)
      })
      return activeNodes;
    },
    drawHoverNode(pos) {
      let hoveredNodes = this.findNodesByPosition(pos);
      let node = hoveredNodes[0];
      this.nodeHovered = node;

      hoveredNodes.forEach((node) => {
        this.drawNode(node, "green")
      })
      this.drawNode(this.nodeHovered, "blue");
    },
    activeMouseControl: function () {
      var self = this;
      var element = this.canvas.fg;

      var screen = {
        bounds: {}
      }

      function calculateBounds() {
        var el = element;
        screen.bounds.w = el.offsetWidth
        screen.bounds.h = el.offsetHeight
        screen.bounds.x = 0
        screen.bounds.y = 0

        while (el.offsetParent) {
          screen.bounds.x += el.offsetLeft
          screen.bounds.y += el.offsetTop
          el = el.offsetParent
        }
      }

      function activeFinger(index, x, y, pressure) {
        var scale = 0.5 + pressure
        $(".finger-" + index)
          .addClass("active")
          .css("transform", 'translate3d(' + x + 'px,' + y + 'px,0)')
      }

      function deactiveFinger(index) {
        $(".finger-" + index).removeClass("active")
      }

      function mouseMoveListener(event) {
        var e = event
        if (e.originalEvent) {
          e = e.originalEvent
        }
        // Skip secondary click
        if (e.which === 3) {
          return
        }
        e.preventDefault()

        var pressure = 0.5
        activeFinger(0, e.pageX, e.pageY, pressure);
        // that.touchMove(0, x / screen.bounds.w, y / screen.bounds.h, pressure);
      }

      function mouseUpListener(event) {
        var e = event
        if (e.originalEvent) {
          e = e.originalEvent
        }
        // Skip secondary click
        if (e.which === 3) {
          return
        }
        e.preventDefault()

        var pos = coord(e);
        // change precision
        pos.px = Math.floor(pos.px * 1000) / 1000;
        pos.py = Math.floor(pos.py * 1000) / 1000;
        pos.x = Math.floor(pos.px * element.width);
        pos.y = Math.floor(pos.py * element.height);
        self.cursor = pos;

        self.nodeHovered = null;
        markPosition(self.cursor)

        stopMousing()
      }

      function stopMousing() {
        element.removeEventListener('mousemove', mouseMoveListener);
        element.addEventListener('mousemove', mouseHoverListener);
        document.removeEventListener('mouseup', mouseUpListener);
        deactiveFinger(0);
      }

      function coord(event) {
        var e = event;
        if (e.originalEvent) {
          e = e.originalEvent
        }
        calculateBounds()
        var x = e.pageX - screen.bounds.x
        var y = e.pageY - screen.bounds.y
        var px = x / screen.bounds.w;
        var py = y / screen.bounds.h;
        return {
          px: px,
          py: py,
          x: Math.floor(px * element.width),
          y: Math.floor(py * element.height),
        }
      }

      function mouseHoverListener(event) {
        var e = event;
        if (e.originalEvent) {
          e = e.originalEvent
        }
        // Skip secondary click
        if (e.which === 3) {
          return
        }
        e.preventDefault()
        // startMousing()

        var x = e.pageX - screen.bounds.x
        var y = e.pageY - screen.bounds.y
        var pos = coord(event);

        self.nodeHoveredList = self.findNodesByPosition(pos);
        self.nodeHovered = self.nodeHoveredList[0];
        self.drawRefresh()

        if (self.cursor.px) {
          markPosition(self.cursor)
        }
      }

      function mouseDownListener(event) {
        var e = event;
        if (e.originalEvent) {
          e = e.originalEvent
        }
        // Skip secondary click
        if (e.which === 3) {
          return
        }
        e.preventDefault()

        fakePinch = e.altKey
        calculateBounds()
        // startMousing()

        var x = e.pageX - screen.bounds.x
        var y = e.pageY - screen.bounds.y
        var pressure = 0.5
        activeFinger(0, e.pageX, e.pageY, pressure);

        if (self.nodeHovered) {
          self.nodeSelected = self.nodeHovered;
          self.drawAllNode();
          // self.drawHoverNode(pos);
          self.drawNode(self.nodeSelected, "red");
          var generatedCode = self.generateNodeSelectorCode(self.nodeSelected);
          if (self.autoCopy) {
            copyToClipboard(generatedCode);
          }
          self.generatedCode = generatedCode;

          self.$jstree.jstree("deselect_all");
          self.$jstree.jstree("close_all");
          self.$jstree.jstree("select_node", "#" + self.nodeHovered._id);
          self.$jstree.jstree(true)._open_to("#" + self.nodeHovered._id);
          document.getElementById(self.nodeHovered._id).scrollIntoView(false);
        }
        // self.touchDown(0, x / screen.bounds.w, y / screen.bounds.h, pressure);

        element.removeEventListener('mousemove', mouseHoverListener);
        element.addEventListener('mousemove', mouseMoveListener);
        document.addEventListener('mouseup', mouseUpListener);
      }

      function markPosition(pos) {
        var ctx = self.canvas.fg.getContext("2d");
        ctx.fillStyle = '#ff0000'; // red
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, 12, 0, 2 * Math.PI)
        ctx.closePath()
        ctx.fill()

        ctx.fillStyle = "#fff"; // white
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, 8, 0, 2 * Math.PI)
        ctx.closePath()
        ctx.fill();
      }

      /* bind listeners */
      element.addEventListener('mousedown', mouseDownListener);
      element.addEventListener('mousemove', mouseHoverListener);
    }
  }
})