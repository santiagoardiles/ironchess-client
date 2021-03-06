/*    Human vs. Stockfish    */

// Setup.
import React, { useState, useEffect } from "react";
import Chess from "chess.js";
import Chessboard from "chessboardjsx";
import MyMoves from "./MyMoves";

// Styles.
import "../../styles/MyBoard.css";

// Variables.
let game;
const STOCKFISH = window.STOCKFISH;

function HumanVsStockfish(props) {
  // Hooks.
  const [fen, setFen] = useState("start");
  const [history, setHistory] = useState([]);
  const [moves, setMoves] = useState("");
  const [turn, setTurn] = useState("");

  // componentDidMount.
  useEffect(() => {
    game = Chess();
    setFen(game.fen());

    engineGame().prepareMove();
  }, []);

  // componentDidUpdate.
  useEffect(() => {
    setMoves(game.pgn());
    setTurn(game.turn());
  });

  const handleDrop = ({ sourceSquare, targetSquare }) => {
    const move = game.move({
      from: sourceSquare,
      to: targetSquare,
      promotion: "q",
    });

    // Checks if move is illegal.
    if (move === null) return;

    return new Promise((resolve) => {
      setFen(game.fen());
      resolve();
    }).then(() => engineGame().prepareMove());
  };

  // The whole engine configuration lies down here.
  const engineGame = (options) => {
    options = options || {};

    let engine =
      typeof STOCKFISH === "function"
        ? STOCKFISH()
        : new Worker(options.stockfishjs || "stockfish.js");

    let evaler =
      typeof STOCKFISH === "function"
        ? STOCKFISH()
        : new Worker(options.stockfishjs || "stockfish.js");

    let engineStatus = {};
    let time = { wtime: 3000, btime: 3000, winc: 1500, binc: 1500 };
    let playerColor = "black"; // The engine is always white.
    let clockTimeoutID = null;
    let announced_game_over;

    setInterval(function () {
      if (announced_game_over) {
        return;
      }

      if (game.game_over()) {
        announced_game_over = true;
      }
    }, 500);

    function uciCmd(cmd, which) {
      (which || engine).postMessage(cmd);
    }
    uciCmd("uci");

    function clockTick() {
      let t =
        (time.clockColor === "white" ? time.wtime : time.btime) +
        time.startTime -
        Date.now();
      let timeToNextSecond = (t % 1000) + 1;
      clockTimeoutID = setTimeout(clockTick, timeToNextSecond);
    }

    function stopClock() {
      if (clockTimeoutID !== null) {
        clearTimeout(clockTimeoutID);
        clockTimeoutID = null;
      }
      if (time.startTime > 0) {
        let elapsed = Date.now() - time.startTime;
        time.startTime = null;
        if (time.clockColor === "white") {
          time.wtime = Math.max(0, time.wtime - elapsed);
        } else {
          time.btime = Math.max(0, time.btime - elapsed);
        }
      }
    }

    function startClock() {
      if (game.turn() === "w") {
        time.wtime += time.winc;
        time.clockColor = "white";
      } else {
        time.btime += time.binc;
        time.clockColor = "black";
      }
      time.startTime = Date.now();
      clockTick();
    }

    function get_moves() {
      let moves = "";
      let history = game.history({ verbose: true });

      for (let i = 0; i < history.length; ++i) {
        let move = history[i];
        moves +=
          " " + move.from + move.to + (move.promotion ? move.promotion : "");
      }

      return moves;
    }

    const prepareMove = () => {
      stopClock();
      // this.setState({ fen: game.fen() });
      let turn = game.turn() === "w" ? "white" : "black";
      if (!game.game_over()) {
        // if (turn === playerColor) {
        if (turn !== playerColor) {
          // playerColor = playerColor === 'white' ? 'black' : 'white';
          uciCmd("position startpos moves" + get_moves());
          uciCmd("position startpos moves" + get_moves(), evaler);
          uciCmd("eval", evaler);

          if (time && time.wtime) {
            uciCmd(
              "go " +
                (time.depth ? "depth " + time.depth : "") +
                " wtime " +
                time.wtime +
                " winc " +
                time.winc +
                " btime " +
                time.btime +
                " binc " +
                time.binc
            );
          } else {
            uciCmd("go " + (time.depth ? "depth " + time.depth : ""));
          }
          // isEngineRunning = true;
        }
        if (game.history().length >= 2 && !time.depth && !time.nodes) {
          startClock();
        }
      }
    };

    evaler.onmessage = function (event) {
      let line;

      if (event && typeof event === "object") {
        line = event.data;
      } else {
        line = event;
      }

      // console.log('evaler: ' + line);

      /// Ignore some output.
      if (
        line === "uciok" ||
        line === "readyok" ||
        line.substr(0, 11) === "option name"
      ) {
        return;
      }
    };

    engine.onmessage = (event) => {
      let line;

      if (event && typeof event === "object") {
        line = event.data;
      } else {
        line = event;
      }
      // console.log('Reply: ' + line);
      if (line === "uciok") {
        engineStatus.engineLoaded = true;
      } else if (line === "readyok") {
        engineStatus.engineReady = true;
      } else {
        let match = line.match(/^bestmove ([a-h][1-8])([a-h][1-8])([qrbn])?/);
        /// Did the AI move?
        if (match) {
          // isEngineRunning = false;
          game.move({ from: match[1], to: match[2], promotion: match[3] });
          setFen(game.fen());
          prepareMove();
          uciCmd("eval", evaler);
          //uciCmd("eval");
          /// Is it sending feedback?
        } else if (
          (match = line.match(/^info .*\bdepth (\d+) .*\bnps (\d+)/))
        ) {
          engineStatus.search = "Depth: " + match[1] + " Nps: " + match[2];
        }

        /// Is it sending feed back with a score?
        if ((match = line.match(/^info .*\bscore (\w+) (-?\d+)/))) {
          let score = parseInt(match[2], 10) * (game.turn() === "w" ? 1 : -1);
          /// Is it measuring in centipawns?
          if (match[1] === "cp") {
            engineStatus.score = (score / 100.0).toFixed(2);
            /// Did it find a mate?
          } else if (match[1] === "mate") {
            engineStatus.score = "Mate in " + Math.abs(score);
          }

          /// Is the score bounded?
          if ((match = line.match(/\b(upper|lower)bound\b/))) {
            engineStatus.score =
              ((match[1] === "upper") === (game.turn() === "w")
                ? "<= "
                : ">= ") + engineStatus.score;
          }
        }
      }
      // displayStatus();
    };

    return {
      start: function () {
        uciCmd("ucinewgame");
        uciCmd("isready");
        engineStatus.engineReady = false;
        engineStatus.search = null;
        prepareMove();
        announced_game_over = false;
      },
      prepareMove: function () {
        prepareMove();
      },
    };
  };

  return props.children({
    position: fen,
    handleDrop,
    moves,
    turn,
  });
}

// Main function.
function MyEngineBoard(props) {
  return (
    <div className="myGamespace">
      <HumanVsStockfish {...props}>
        {({ position, handleDrop, moves, turn }) => (
          <div className="myChessboard">
            <Chessboard
              id="stockfish"
              position={position}
              width={550}
              onDrop={handleDrop}
              orientation="black"
              boardStyle={{
                borderRadius: "5px",
                boxShadow: `0 5px 15px rgba(0, 0, 0, 0.5)`,
              }}
            />

            <MyMoves moves={moves} turn={turn}></MyMoves>
          </div>
        )}
      </HumanVsStockfish>
    </div>
  );
}

export default MyEngineBoard;
