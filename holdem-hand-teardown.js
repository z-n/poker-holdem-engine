
'use strict';

const config = require('./config');

const sortByRank = require('poker-rank');
const getCombinations = require('poker-combinations');

const status = require('./domain/player-status');

const run = require('./lib/generator-runner');
const save = require('./storage').save;

const showdown = require('./holdem/showdown');
const assignPot = require('./holdem/assign-pot');
const updatePlayersStatus = require('./holdem/update-players-status');

const winston = require('./log-setup');
const gamestory = winston.loggers.get('gamestory');
const errors = winston.loggers.get('errors');



function* teardownOps(gs){

  const tag = { id: gs.handId };

  //
  // in this phase of the hand only the active players can partecipate
  const activePlayers = gs.players.filter(player => player.status == status.active);
  gamestory.info('Active players at the showdown: %s', activePlayers.map(p => p.name).toString().replace(/,/g, ', '), tag);

  //
  // 1) showdown
  // sort the player by the strength of their best point
  let sortedPlayers = yield showdown(activePlayers, gs.community_cards);
  gamestory.info('Showdown results: %s', JSON.stringify(sortedPlayers), tag);
  yield save(gs, { type: 'showdown', handId: gs.handId, players: sortedPlayers.map(p => Object.assign({}, p)) });

  //
  // 2) assign pot to the winner(s) of the current hand
  // be careful about all-in split, exequos
  yield assignPot(gs, sortedPlayers);

  //
  // 3) update players' status
  for (let i=0; i<activePlayers.length; i++){
    let player = activePlayers[i];
    if (player.chips === 0){
      gamestory.info('%s (%d) is out.', player.name, player.id, { id: gs.handId, type: 'status' });
      yield save(gs, { type: 'status', handId: gs.handId, playerId: player.id, status: 'out' });
    }
  }

  updatePlayersStatus(gs);

  //
  // 4) reset pot
  gs.pot = 0;

}


exports = module.exports = function teardown(gs){

  return run(teardownOps, gs).catch(function(err) {
    let tag = { id: gs.handId };
    errors.error('An error occurred during the execution of the teardown. Stack: %s.', err.stack, tag);
    errors.error('Game state: %s.', JSON.stringify(gs), tag);
  });

};