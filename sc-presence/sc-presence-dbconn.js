
var pool;
var pool_connection;
var options;
var mysql = require("mysql");


module.exports.connect = function (in_options) {
    options = in_options;
    pool = mysql.createPool(options);
    tryConnect();
}



function tryConnect()
{      
    pool.getConnection(function (error, connection) {
        if (error) {
            console.log(error);
            setTimeout(function () { tryConnect(); }, 15000);
        } else {
            pool.on("error", function (err) {
                console.log(module.parent.filename);
                console.log(err);
                setTimeout(function () { tryConnect(); }, 15000);
            });
        }

        pool_connection = connection;
    });
}



exports.getClient = function () {
    return pool_connection;
};


module.exports.reconnect = function (callback) {
    tryConnect();
    if (typeof callback === "function") {
        callback();
    }
}