var utils = require( '../utils.js' );
var stubs = require( './stubs.js' );

QUnit.test( "utils.isHexColour", function( assert )
{
    assert.ok( utils.isHexColour( "" ) === false );
    assert.ok( utils.isHexColour( "red" ) === false );
    assert.ok( utils.isHexColour( "ff0000" ) === true );
    assert.ok( utils.isHexColour( "fff" ) === true );
} );

QUnit.test( "utils.isHexColour strips non RGB values", function( assert )
{
    assert.ok( utils.isHexColour( "#ff00ff" ) === true );
    assert.ok( utils.isHexColour( "#0ff" ) === true );
    assert.ok( utils.isHexColour( "bedding" ) === false );
    assert.ok( utils.isHexColour( "inbed" ) === true );
} );

QUnit.test( "utils.removeBlockComments strips block comments based on filename", function( assert )
{
    assert.equal( utils.removeBlockComments( "/* a */", "x.cpp" ), " a " );
    assert.equal( utils.removeBlockComments( "// a //", "x.cpp" ), "// a //" );
    assert.equal( utils.removeBlockComments( "/* a */", "x.js" ), " a " );
    assert.equal( utils.removeBlockComments( "/* a */", "x.txt" ), "/* a */" );
    assert.equal( utils.removeBlockComments( "<!-- a -->", "x.html" ), " a " );
    assert.equal( utils.removeBlockComments( "  /* a */", "x.cpp" ), " a " );
    assert.equal( utils.removeBlockComments( "b /* a */", "x.cpp" ), "b /* a */" );
} );

QUnit.test( "utils.extractTag removes everything including tag", function( assert )
{
    var testConfig = stubs.getTestConfig();
    testConfig.shouldGroupFlag = true;
    utils.init( testConfig );

    var result = utils.extractTag( "before DEKO after" );
    assert.equal( result.tag, "DEKO" );
    assert.equal( result.withoutTag, "after" );
} );

QUnit.test( "utils.extractTag can be case sensitive", function( assert )
{
    var testConfig = stubs.getTestConfig();
    testConfig.shouldGroupFlag = true;
    testConfig.shouldBeCaseSensitive = false;
    utils.init( testConfig );

    var result = utils.extractTag( "before deko after" );
    assert.equal( result.tag, "DEKO" );
    assert.equal( result.withoutTag, "after" );

    testConfig.shouldBeCaseSensitive = true;
    result = utils.extractTag( "before deko after" );
    assert.equal( result.tag, "" );
    assert.equal( result.withoutTag, "before deko after" );
} );

QUnit.test( "utils.extractTag returns tag from tags list, not the match", function( assert )
{
    var testConfig = stubs.getTestConfig();
    testConfig.shouldGroupFlag = true;
    utils.init( testConfig );

    var result = utils.extractTag( "before deko after" );
    assert.equal( result.tag, "DEKO" );
    assert.equal( result.withoutTag, "after" );
} );

QUnit.test( "utils.getRegexSource returns the regex source without expanded tags if they aren't present", function( assert )
{
    var testConfig = stubs.getTestConfig();
    testConfig.regexSource = "notags";
    utils.init( testConfig );

    assert.equal( utils.getRegexSource(), "notags" );
} );

QUnit.test( "utils.getRegexSource returns the regex source with expanded tags", function( assert )
{
    var testConfig = stubs.getTestConfig();
    testConfig.tagList = [ "ONE", "TWO" ];
    utils.init( testConfig );

    assert.equal( utils.getRegexSource(), "(ONE|TWO)" );
} );

QUnit.test( "utils.getRegexSource returns the regex source and converts backslashes to hex", function( assert )
{
    var testConfig = stubs.getTestConfig();
    testConfig.tagList = [ "ONE\\", "\\TWO" ];
    utils.init( testConfig );

    assert.equal( utils.getRegexSource(), "(ONE\\x5c|\\x5cTWO)" );
} );

QUnit.test( "utils.getRegex applies the expected default flags", function( assert )
{
    var testConfig = stubs.getTestConfig();
    utils.init( testConfig );
    assert.equal( utils.getRegex().flags, "gim" );
} );

QUnit.test( "utils.getRegex can remove the case insensitive flag", function( assert )
{
    var testConfig = stubs.getTestConfig();
    testConfig.shouldBeCaseSensitive = true;
    utils.init( testConfig );
    assert.equal( utils.getRegex().flags, "gm" );
} );

QUnit.test( "utils.isIncluded returns true when no includes or excludes are specified", function( assert )
{
    assert.ok( utils.isIncluded( "filename.js", [], [] ) === true );
    assert.ok( utils.isIncluded( "filename.txt", [], [] ) === true );
} );

QUnit.test( "utils.isIncluded returns false when name matches excludes", function( assert )
{
    assert.ok( utils.isIncluded( "filename.js", [], [ "*.txt" ] ) === true );
    assert.ok( utils.isIncluded( "filename.txt", [], [ "*.txt" ] ) === false );
} );

QUnit.test( "utils.isIncluded returns false when name doesn't match includes", function( assert )
{
    assert.ok( utils.isIncluded( "filename.js", [ "*.txt" ], [] ) === false );
    assert.ok( utils.isIncluded( "filename.txt", [ "*.txt" ], [] ) === true );
} );

QUnit.test( "utils.isIncluded returns false when name matches includes but also matches excludes", function( assert )
{
    assert.ok( utils.isIncluded( "filename.js", [ "*.txt" ], [ "*.js" ] ) === false );
    assert.ok( utils.isIncluded( "filename.txt", [ "*.txt" ], [ "*.txt" ] ) === false );
    assert.ok( utils.isIncluded( "filename.js", [ "*.txt" ], [ "*.txt" ] ) === false );
    assert.ok( utils.isIncluded( "filename.js", [ "*.txt", "*.js" ], [ "*.txt" ] ) === true );
} );

QUnit.test( "utils.formatLabel replaces line number placeholder", function( assert )
{
    assert.equal( utils.formatLabel( "Label ${line} content", { line: 23 } ), "Label 24 content" ); // line is zero based
} );

QUnit.test( "utils.formatLabel replaces column number placeholder", function( assert )
{
    assert.equal( utils.formatLabel( "Label ${column} content", { column: 78 } ), "Label 78 content" );
} );

QUnit.test( "utils.formatLabel replaces before text placeholder", function( assert )
{
    assert.equal( utils.formatLabel( "Label ${before} content", { before: "text before tag" } ), "Label text before tag content" );
} );

QUnit.test( "utils.formatLabel replaces tag placeholder", function( assert )
{
    assert.equal( utils.formatLabel( "Label ${tag} content", { tag: "DEKO" } ), "Label DEKO content" );
} );

QUnit.test( "utils.formatLabel replaces after text placeholder", function( assert )
{
    assert.equal( utils.formatLabel( "Label ${after} content", { after: "text after tag" } ), "Label text after tag content" );
} );

QUnit.test( "utils.formatLabel replaces before text placeholder", function( assert )
{
    assert.equal( utils.formatLabel( "Label ${before} content", { before: "text before tag" } ), "Label text before tag content" );
} );
