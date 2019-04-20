/* jshint esversion:6 */

var vscode = require( 'vscode' );
var ripgrep = require( './ripgrep' );
var path = require( 'path' );

var tree = require( "./tree.js" );
var highlights = require( './highlights.js' );
var config = require( './config.js' );
var utils = require( './utils.js' );

var searchResults = [];
var searchList = [];
var currentFilter;
var interrupted = false;
var selectedDocument;
var refreshTimeout;
var openDocuments = {};

function activate( context )
{
    var buildCounter = context.workspaceState.get( 'buildCounter', 1 );
    context.workspaceState.update( 'buildCounter', ++buildCounter );

    config.init( context );
    highlights.init( context );
    utils.init( config );

    var provider = new tree.TreeNodeProvider( context );
    var status = vscode.window.createStatusBarItem( vscode.StatusBarAlignment.Left, 0 );

    var dekoTreeViewExplorer = vscode.window.createTreeView( "deko-tree-view-explorer", { treeDataProvider: provider } );
    var dekoTreeView = vscode.window.createTreeView( "deko-tree-view", { treeDataProvider: provider } ); //@v Create a Tree from the tree data provider
    //@o There is a treeDataProvider

    var outputChannel;

    context.subscriptions.push( provider );
    context.subscriptions.push( status );
    context.subscriptions.push( dekoTreeViewExplorer );
    context.subscriptions.push( dekoTreeView );

    function resetOutputChannel()
    {
        if( outputChannel )
        {
            outputChannel.dispose();
            outputChannel = undefined;
        }
        if( vscode.workspace.getConfiguration( 'deko-tree' ).debug === true )
        {
            outputChannel = vscode.window.createOutputChannel( "Deko Tree" );
        }
    }

    function debug( text )
    {
        if( outputChannel )
        {
            outputChannel.appendLine( text );
        }
    }

    function refreshTree()
    {
        clearTimeout( refreshTimeout );
        refreshTimeout = setTimeout( function()
        {
            provider.refresh();
            setButtonsAndContext();
        }, 200 );
    }

    function addResultsToTree()
    {
        function trimMatchesOnSameLine( searchResults )
        {
            searchResults.forEach( function( match )
            {
                searchResults.map( function( m )
                {
                    if( match.file === m.file && match.line === m.line && match.column < m.column )
                    {
                        match.match = match.match.substr( 0, m.column - 1 );
                    }
                } );
            } );
        }

        trimMatchesOnSameLine( searchResults );

        searchResults.sort( function compare( a, b )
        {
            return a.file > b.file ? 1 : b.file > a.file ? -1 : a.line > b.line ? 1 : -1;
        } );
        searchResults.map( function( match )
        {
            if( match.added !== true )
            {
                provider.add( match );
                match.added = true;
            }
        } );

        if( interrupted === false )
        {
            updateStatusBar();
        }

        provider.filter( currentFilter );
        refreshTree();
    }

    function updateStatusBar()
    {
        var counts = provider.getTagCounts();

        if( vscode.workspace.getConfiguration( 'deko-tree' ).statusBar === 'total' )
        {
            var total = Object.values( counts ).reduce( function( a, b ) { return a + b; }, 0 );

            status.text = "$(check):" + total;
            status.tooltip = "Deko-Tree total";

            if( total > 0 )
            {
                status.show();
            }
            else
            {
                status.hide();
            }
        }
        else if( vscode.workspace.getConfiguration( 'deko-tree' ).statusBar === 'tags' ||
            vscode.workspace.getConfiguration( 'deko-tree' ).statusBar === 'top three' )
        {
            var text = "$(check) ";
            var sortedTags = Object.keys( counts );
            sortedTags.sort( function( a, b ) { return counts[ a ] < counts[ b ] ? 1 : counts[ b ] < counts[ a ] ? -1 : a > b ? 1 : -1; } );
            if( vscode.workspace.getConfiguration( 'deko-tree' ).statusBar === 'top three' )
            {
                sortedTags = sortedTags.splice( 0, 3 );
            }
            sortedTags.map( function( tag )
            {
                text += tag + ":" + counts[ tag ] + " ";
            } );
            status.text = text;
            status.tooltip = "Deko-Tree tags counts";
            if( Object.keys( counts ).length > 0 )
            {
                status.show();
            }
            else
            {
                status.hide();
            }
        }
        else
        {
            status.hide();
        }

        status.command = "deko-tree.toggleStatusBar";
    }

    function toggleStatusBar()
    {
        var newSetting = vscode.workspace.getConfiguration( 'deko-tree' ).statusBar === 'total' ? "top three" : "total";
        vscode.workspace.getConfiguration( 'deko-tree' ).update( 'statusBar', newSetting, true );
    }

    function removeFileFromSearchResults( filename )
    {
        searchResults = searchResults.filter( match =>
        {
            return match.file !== filename;
        } );
    }

    function search( options, done )
    {
        function onComplete()
        {
            if( done )
            {
                done();
            }
        }

        debug( "Searching " + options.filename + "..." );

        ripgrep.search( "/", options ).then( matches =>
        {
            if( matches.length > 0 )
            {
                matches.forEach( match =>
                {
                    debug( " Match: " + JSON.stringify( match ) );
                    searchResults.push( match );
                } );
            }
            else if( options.filename )
            {
                removeFileFromSearchResults( options.filename );
            }

            onComplete();
        } ).catch( e =>
        {
            var message = e.message;
            if( e.stderr )
            {
                message += " (" + e.stderr + ")";
            }
            vscode.window.showErrorMessage( "deko-tree: " + message );
            onComplete();
        } );
    }

    function getOptions( filename )
    {
        var c = vscode.workspace.getConfiguration( 'deko-tree' );

        var options = {
            regex: "\"" + utils.getRegexSource() + "\"",
            rgPath: config.ripgrepPath()
        };
        var globs = c.globs;
        if( globs && globs.length > 0 )
        {
            options.globs = globs;
        }
        if( filename )
        {
            options.filename = filename;
        }

        options.outputChannel = outputChannel;
        options.additional = c.ripgrepArgs;
        options.maxBuffer = c.ripgrepMaxBuffer;

        if( vscode.workspace.getConfiguration( 'deko-tree' ).get( 'regexCaseSensitive' ) === false )
        {
            options.additional += '-i ';
        }

        return options;
    }

    function searchWorkspaces( searchList )
    {
        if( vscode.workspace.getConfiguration( 'deko-tree' ).showTagsFromOpenFilesOnly !== true )
        {
            var includes = vscode.workspace.getConfiguration( 'deko-tree' ).get( 'includedWorkspaces', [] );
            var excludes = vscode.workspace.getConfiguration( 'deko-tree' ).get( 'excludedWorkspaces', [] );
            if( vscode.workspace.workspaceFolders )
            {
                vscode.workspace.workspaceFolders.map( function( folder )
                {
                    if( utils.isIncluded( folder.name, includes, excludes ) )
                    {
                        searchList.push( folder.uri.fsPath );
                    }
                } );
            }
        }
    }

    function refreshOpenFiles()
    {
        Object.keys( openDocuments ).map( function( document )
        {
            refreshFile( openDocuments[ document ] );
        } );
    }

    function applyGlobs()
    {
        var includeGlobs = vscode.workspace.getConfiguration( 'deko-tree' ).get( 'includeGlobs' );
        var excludeGlobs = vscode.workspace.getConfiguration( 'deko-tree' ).get( 'excludeGlobs' );

        if( includeGlobs.length + excludeGlobs.length > 0 )
        {
            debug( "Applying globs to " + searchResults.length + " items..." );

            searchResults = searchResults.filter( function( match )
            {
                return utils.isIncluded( match.file, includeGlobs, excludeGlobs );
            } );

            debug( "Remaining items: " + searchResults.length );
        }
    }

    function iterateSearchList()
    {
        if( searchList.length > 0 )
        {
            var entry = searchList.pop();
            search( getOptions( entry ), ( searchList.length > 0 ) ? iterateSearchList : function()
            {
                debug( "Found " + searchResults.length + " items" );
                applyGlobs();
                addResultsToTree();
                setButtonsAndContext();
            } );
        }
        else
        {
            addResultsToTree();
            setButtonsAndContext();
        }
    }

    function rebuild()
    {
        function getRootFolders()
        {
            var rootFolders = [];
            var valid = true;
            var rootFolder = vscode.workspace.getConfiguration( 'deko-tree' ).get( 'rootFolder' );
            var envRegex = new RegExp( "\\$\\{(.*?)\\}", "g" );
            if( rootFolder.indexOf( "${workspaceFolder}" ) > -1 )
            {
                if( vscode.workspace.workspaceFolders )
                {
                    vscode.workspace.workspaceFolders.map( function( folder )
                    {
                        var path = rootFolder;
                        path = path.replace( /\$\{workspaceFolder\}/g, folder.uri.fsPath );
                        rootFolders.push( path );
                    } );
                }
                else
                {
                    valid = false;
                }
            }
            else if( rootFolder !== "" )
            {
                rootFolders.push( rootFolder );
            }

            rootFolders.forEach( function( rootFolder )
            {
                rootFolder = rootFolder.replace( envRegex, function( match, name )
                {
                    return process.env[ name ];
                } );
            } );

            var includes = vscode.workspace.getConfiguration( 'deko-tree' ).get( 'includedWorkspaces', [] );
            var excludes = vscode.workspace.getConfiguration( 'deko-tree' ).get( 'excludedWorkspaces', [] );

            if( valid === true )
            {
                rootFolders = rootFolders.filter( function( folder )
                {
                    return utils.isIncluded( folder, includes, excludes );
                } );
            }

            return valid === true ? rootFolders : undefined;
        }

        searchResults = [];
        searchList = [];

        provider.clear( vscode.workspace.workspaceFolders );
        clearFilter();

        interrupted = false;

        status.text = "deko-tree: Scanning...";
        status.show();
        status.command = "deko-tree.stopScan";
        status.tooltip = "Click to interrupt scan";

        searchList = getRootFolders();

        if( searchList.length === 0 )
        {
            searchWorkspaces( searchList );
        }

        iterateSearchList();

        refreshOpenFiles();
    }

    function setButtonsAndContext()
    {
        var c = vscode.workspace.getConfiguration( 'deko-tree' );
        var isTagsOnly = context.workspaceState.get( 'tagsOnly', c.get( 'tagsOnly', false ) );
        var isGrouped = context.workspaceState.get( 'grouped', c.get( 'grouped', false ) );
        var isCollapsible = !isTagsOnly || isGrouped;
        vscode.commands.executeCommand( 'setContext', 'deko-tree-expanded', context.workspaceState.get( 'expanded', c.get( 'expanded', false ) ) );
        vscode.commands.executeCommand( 'setContext', 'deko-tree-flat', context.workspaceState.get( 'flat', c.get( 'flat', false ) ) );
        vscode.commands.executeCommand( 'setContext', 'deko-tree-tags-only', isTagsOnly );
        vscode.commands.executeCommand( 'setContext', 'deko-tree-grouped', isGrouped );
        vscode.commands.executeCommand( 'setContext', 'deko-tree-filtered', context.workspaceState.get( 'filtered', false ) );
        vscode.commands.executeCommand( 'setContext', 'deko-tree-collapsible', isCollapsible );

        var children = provider.getChildren();
        var empty = children.length === 1 && children[ 0 ].empty === true;

        vscode.commands.executeCommand( 'setContext', 'deko-tree-has-content', empty === false );
    }

    function isIncluded( filename )
    {
        var includeGlobs = vscode.workspace.getConfiguration( 'deko-tree' ).get( 'includeGlobs' );
        var excludeGlobs = vscode.workspace.getConfiguration( 'deko-tree' ).get( 'excludeGlobs' );

        return utils.isIncluded( filename, includeGlobs, excludeGlobs ) === true;
    }

    function refreshFile( document )
    {
        var matchesFound = false;

        removeFileFromSearchResults( document.fileName );

        if( isIncluded( document.fileName ) === true )
        {
            var text = document.getText();
            var regex = utils.getRegex();

            var match;
            while( ( match = regex.exec( text ) ) !== null )
            {
                while( text[ match.index ] === '\n' || text[ match.index ] === '\r' )
                {
                    match.index++;
                }
                var position = document.positionAt( match.index );
                var line = document.lineAt( position.line );
                var result = {
                    file: document.fileName,
                    line: position.line + 1,
                    column: position.character + 1,
                    match: line.text
                };
                var found = false;
                searchResults.map( function( s )
                {
                    if( s.file === result.file && s.line == result.line && s.column == result.column )
                    {
                        found = true;
                    }
                } );
                if( found === false )
                {
                    searchResults.push( result );
                    matchesFound = true;
                }
            }
        }

        if( matchesFound === true )
        {
            provider.reset( document.fileName );
        }
        else
        {
            provider.remove( document.fileName );
        }

        addResultsToTree();
    }

    function refresh()
    {
        searchResults.forEach( function( match )
        {
            match.added = false;
        } );
        provider.clear( vscode.workspace.workspaceFolders );
        provider.rebuild();

        refreshOpenFiles();

        addResultsToTree();
        setButtonsAndContext();
    }

    function clearExpansionStateAndRefresh()
    {
        provider.clearExpansionState();
        refresh();
    }

    function showFlatView()
    {
        context.workspaceState.update( 'tagsOnly', false );
        context.workspaceState.update( 'flat', true ).then( refresh );
    }

    function showTagsOnlyView()
    {
        context.workspaceState.update( 'flat', false );
        context.workspaceState.update( 'tagsOnly', true ).then( refresh );
    }

    function showTreeView()
    {
        context.workspaceState.update( 'tagsOnly', false );
        context.workspaceState.update( 'flat', false ).then( refresh );
    }

    function collapse() { context.workspaceState.update( 'expanded', false ).then( clearExpansionStateAndRefresh ); }
    function expand() { context.workspaceState.update( 'expanded', true ).then( clearExpansionStateAndRefresh ); }
    function groupByTag() { context.workspaceState.update( 'grouped', true ).then( refresh ); }
    function ungroupByTag() { context.workspaceState.update( 'grouped', false ).then( refresh ); }

    function clearFilter()
    {
        currentFilter = undefined;
        context.workspaceState.update( 'filtered', false );
        provider.clearFilter();
        refreshTree();
    }

    function addTag()
    {
        vscode.window.showInputBox( { prompt: "New tag", placeHolder: "e.g. FIXME" } ).then( function( tag )
        {
            if( tag )
            {
                var tags = vscode.workspace.getConfiguration( 'deko-tree' ).get( 'tags' );
                if( tags.indexOf( tag ) === -1 )
                {
                    tags.push( tag );
                    vscode.workspace.getConfiguration( 'deko-tree' ).update( 'tags', tags, true );
                }
            }
        } );
    }

    function removeTag()
    {
        var tags = vscode.workspace.getConfiguration( 'deko-tree' ).get( 'tags' );
        vscode.window.showQuickPick( tags, { matchOnDetail: true, matchOnDescription: true, canPickMany: true, placeHolder: "Select tags to remove" } ).then( function( tagsToRemove )
        {
            tagsToRemove.map( tag =>
            {
                tags = tags.filter( t => tag != t );
            } );
            vscode.workspace.getConfiguration( 'deko-tree' ).update( 'tags', tags, true );
        } );
    }

    function register()
    {
        function migrateSettings()
        {
            var config = vscode.workspace.getConfiguration( 'deko-tree' );
            if( config.get( 'highlight' ) === true )
            {
                config.update( 'highlight', 'tag', true );
            }
            else if( config.get( 'highlight' ) === false )
            {
                config.update( 'highlight', 'none', true );
            }

            var defaultHighlight = config.get( 'defaultHighlight' );
            if( Object.keys( defaultHighlight ).length === 0 )
            {
                defaultHighlight.foreground = config.get( 'iconColour' );
                defaultHighlight.type = config.get( 'highlight' );

                config.update( 'defaultHighlight', defaultHighlight, true );
            }

            var customHighlight = config.get( 'customHighlight' );
            if( Object.keys( customHighlight ).length === 0 )
            {
                var tags = config.get( 'tags' );
                var icons = config.get( 'icons' );
                var iconColours = config.get( 'iconColours' );

                tags.map( function( tag )
                {
                    try {
                        customHighlight[ tag ] = {};
                        if( icons[ tag ] !== undefined )
                        {
                            customHighlight[ tag ].icon = icons[ tag ];
                        }
                        if( iconColours[ tag ] !== undefined )
                        {
                            customHighlight[ tag ].foreground = iconColours[ tag ];
                        }
                        
                    } catch (error) {
                        console.log(error);
                    }
                } );

                config.update( 'customHighlight', customHighlight, true );
            }

            var globs = config.get( 'globs' );
            if( globs && globs.length > 0 && context.workspaceState.get( 'globsMigrated' ) !== true )
            {
                var prompt = "'deko-tree.globs' has been deprecated. Please use 'deko-tree.includeGlobs' and 'deko-tree.excludeGlobs' instead.";
                var migrate = "Migrate settings";
                var neverAgain = "Don't show again";

                vscode.window.showWarningMessage( prompt, migrate, 'Ignore', neverAgain ).then( function( response )
                {
                    if( response === migrate )
                    {
                        var includeGlobs = [];
                        var excludeGlobs = [];
                        config.globs.map( function( glob )
                        {
                            if( glob.trim().indexOf( '!' ) === 0 )
                            {
                                excludeGlobs.push( glob.trim().substring( 1 ) );
                            }
                            else
                            {
                                includeGlobs.push( glob );
                            }
                        } );

                        config.update( 'includeGlobs', includeGlobs, true );
                        config.update( 'excludeGlobs', excludeGlobs, true );

                        context.workspaceState.update( 'globsMigrated', true );
                    }
                    else if( response == neverAgain )
                    {
                        context.workspaceState.update( 'globsMigrated', true );
                    }
                } );
            }
        }

        function showInTree( uri )
        {
            console.log("TESTING:: function showInTree( uri )");
            if( vscode.workspace.getConfiguration( 'deko-tree' ).trackFile === true )
            {
                provider.getElement( uri.fsPath, function( element )
                {
                    if( dekoTreeViewExplorer.visible === true )
                    {
                        dekoTreeViewExplorer.reveal( element, { focus: false, select: true } );
                    }
                    if( dekoTreeView.visible === true )
                    {
                        dekoTreeView.reveal( element, { focus: false, select: true } );
                    }
                } );
            }
        }

        function documentChanged( document )
        {
            vscode.window.visibleTextEditors.map( editor =>
            {
                if( document === editor.document )
                {
                    if( document.fileName === undefined || isIncluded( document.fileName ) )
                    {
                        highlights.triggerHighlight( editor );
                    }
                }
            } );
        }

        // We can't do anything if we can't find ripgrep
        if( !config.ripgrepPath() )
        {
            vscode.window.showErrorMessage( "deko-tree: Failed to find vscode-ripgrep - please install ripgrep manually and set 'deko-tree.ripgrep' to point to the executable" );
            return;
        }

        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.revealDeko', ( file, line ) =>
        {
            selectedDocument = file;
            vscode.workspace.openTextDocument( file ).then( function( document )
            {
                vscode.window.showTextDocument( document ).then( function( editor )
                {
                    var position = new vscode.Position( line, 0 );
                    editor.selection = new vscode.Selection( position, position );
                    editor.revealRange( editor.selection, vscode.TextEditorRevealType.InCenter );
                    vscode.commands.executeCommand( 'workbench.action.focusActiveEditorGroup' );
                } );
            } );
        } ) );

        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.filter', function()
        {
            vscode.window.showInputBox( { prompt: "Filter tree" } ).then(
                function( term )
                {
                    currentFilter = term;
                    if( currentFilter )
                    {
                        context.workspaceState.update( 'filtered', true );
                        provider.filter( currentFilter );
                        refreshTree();
                    }
                } );
        } ) );

        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.stopScan', function()
        {
            ripgrep.kill();
            status.text = "deko-tree: Scanning interrupted.";
            status.tooltip = "Click to restart";
            status.command = "deko-tree.refresh";
            interrupted = true;
        } ) );

        context.subscriptions.push( dekoTreeViewExplorer.onDidExpandElement( function( e ) { provider.setExpanded( e.element.fsPath, true ); } ) );
        context.subscriptions.push( dekoTreeView.onDidExpandElement( function( e ) { provider.setExpanded( e.element.fsPath, true ); } ) );
        context.subscriptions.push( dekoTreeViewExplorer.onDidCollapseElement( function( e ) { provider.setExpanded( e.element.fsPath, false ); } ) );
        context.subscriptions.push( dekoTreeView.onDidCollapseElement( function( e ) { provider.setExpanded( e.element.fsPath, false ); } ) );

        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.filterClear', clearFilter ) );
        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.refresh', rebuild ) );
        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.showFlatView', showFlatView ) );
        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.showTagsOnlyView', showTagsOnlyView ) );
        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.showTreeView', showTreeView ) );
        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.expand', expand ) );
        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.collapse', collapse ) );
        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.groupByTag', groupByTag ) );
        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.ungroupByTag', ungroupByTag ) );
        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.addTag', addTag ) );
        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.removeTag', removeTag ) );
        context.subscriptions.push( vscode.commands.registerCommand( 'deko-tree.toggleStatusBar', toggleStatusBar ) );

        context.subscriptions.push( vscode.window.onDidChangeActiveTextEditor( function( e )
        {
            if( e && e.document )
            {
                openDocuments[ e.document.fileName ] = e.document;

                if( vscode.workspace.getConfiguration( 'deko-tree' ).autoRefresh === true )
                {
                    if( e.document.uri && e.document.uri.scheme === "file" )
                    {
                        if( selectedDocument !== e.document.fileName )
                        {
                            setTimeout( showInTree, 800, e.document.uri );
                        }
                        selectedDocument = undefined;
                    }
                }

                documentChanged( e.document );
            }
        } ) );

        context.subscriptions.push( vscode.workspace.onDidSaveTextDocument( document =>
        {
            if( document.uri.scheme === "file" && path.basename( document.fileName ) !== "settings.json" )
            {
                if( vscode.workspace.getConfiguration( 'deko-tree' ).autoRefresh === true )
                {
                    refreshFile( document );
                }
            }
        } ) );

        context.subscriptions.push( vscode.workspace.onDidOpenTextDocument( document =>
        {
            if( vscode.workspace.getConfiguration( 'deko-tree' ).autoRefresh === true )
            {
                if( document.uri.scheme === "file" )
                {
                    openDocuments[ document.fileName ] = document;
                    refreshFile( document );
                }
            }
        } ) );

        context.subscriptions.push( vscode.workspace.onDidCloseTextDocument( document =>
        {
            delete openDocuments[ document.fileName ];

            if( vscode.workspace.getConfiguration( 'deko-tree' ).autoRefresh === true )
            {
                if( document.uri.scheme === "file" && vscode.workspace.getConfiguration( 'deko-tree' ).showTagsFromOpenFilesOnly === true )
                {
                    removeFileFromSearchResults( document.fileName );
                    provider.remove( document.fileName );
                    refreshTree();
                    updateStatusBar();
                }
            }
        } ) );

        context.subscriptions.push( vscode.workspace.onDidChangeConfiguration( function( e )
        {
            if( e.affectsConfiguration( "deko-tree" ) )
            {
                if( e.affectsConfiguration( "deko-tree.iconColour" ) ||
                    e.affectsConfiguration( "deko-tree.defaultHighlight" ) ||
                    e.affectsConfiguration( "deko-tree.customHighlight" ) )
                {
                    highlights.refreshComplementaryColours();
                }

                if( e.affectsConfiguration( "deko-tree.debug" ) )
                {
                    resetOutputChannel();
                }

                if( e.affectsConfiguration( "deko-tree.includeGlobs" ) ||
                    e.affectsConfiguration( "deko-tree.excludeGlobs" ) ||
                    e.affectsConfiguration( "deko-tree.regex" ) ||
                    e.affectsConfiguration( "deko-tree.ripgrep" ) ||
                    e.affectsConfiguration( "deko-tree.ripgrepArgs" ) ||
                    e.affectsConfiguration( "deko-tree.ripgrepMaxBuffer" ) ||
                    e.affectsConfiguration( "deko-tree.rootFolder" ) ||
                    e.affectsConfiguration( "deko-tree.showTagsFromOpenFilesOnly" ) ||
                    e.affectsConfiguration( "deko-tree.includedWorkspaces" ) ||
                    e.affectsConfiguration( "deko-tree.excludedWorkspaces" ) ||
                    e.affectsConfiguration( "deko-tree.tags" ) ||
                    e.affectsConfiguration( "deko-tree.tagsOnly" ) )
                {
                    rebuild();
                    documentChanged();
                }
                else
                {
                    refresh();
                }

                vscode.commands.executeCommand( 'setContext', 'deko-tree-in-explorer', vscode.workspace.getConfiguration( 'deko-tree' ).showInExplorer );
                setButtonsAndContext();
            }
        } ) );

        context.subscriptions.push( vscode.workspace.onDidChangeWorkspaceFolders( function()
        {
            provider.clear( vscode.workspace.workspaceFolders );
            provider.rebuild();
            rebuild();
        } ) );

        context.subscriptions.push( vscode.workspace.onDidChangeTextDocument( function( e )
        {
            documentChanged( e.document );
        } ) );

        context.subscriptions.push( outputChannel );

        vscode.commands.executeCommand( 'setContext', 'deko-tree-in-explorer', vscode.workspace.getConfiguration( 'deko-tree' ).showInExplorer );

        resetOutputChannel();

        highlights.refreshComplementaryColours();

        migrateSettings();
        setButtonsAndContext();
        rebuild();

        var editors = vscode.window.visibleTextEditors;
        editors.map( function( editor )
        {
            if( editor.document && editor.document.uri.scheme === "file" )
            {
                openDocuments[ editor.document.fileName ] = editor.document;
            }
            refreshOpenFiles();
        } );

        if( vscode.window.activeTextEditor )
        {
            documentChanged( vscode.window.activeTextEditor.document );
        }
    }

    register();
}

function deactivate()
{
    provider.clear( [] );
}

exports.activate = activate;
exports.deactivate = deactivate;
