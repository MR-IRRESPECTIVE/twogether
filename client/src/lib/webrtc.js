import { socket } from "./socket.js";

export class WebRTCManager {
  constructor(myId, onStreamsUpdate) {
    this.myId = myId;
    this.peerConnections = new Map();
    this.remoteStreams = new Map();
    this.pendingCandidates = new Map();
    this.makingOffer = new Map();
    this.ignoreOffer = new Map(); // Added ignoreOffer state tracking
    this.localStream = null;
    this.onStreamsUpdate = onStreamsUpdate;
    console.log(`[WEBRTC] Manager initialized for localUserId: ${myId}`);
  }

  init(localStream, roomParticipants) {
    console.log(`[WEBRTC] init called. participants:`, roomParticipants?.map(p => p.id));
    this.localStream = localStream;
    if (roomParticipants && Array.isArray(roomParticipants)) {
      this.updateParticipants(roomParticipants);
    }
    // Broadcast ready to all room members
    socket.emit("signal:ready", { from: this.myId });
  }

  getIceConfig() {
    return {
      iceServers: [
        { urls: (import.meta.env && import.meta.env.VITE_TURN_URL) ? import.meta.env.VITE_TURN_URL : "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
      ]
    };
  }

  _logTrackAdd(socketId, track, pc) {
    console.log(`[WEBRTC][TRACK-ADD]\nlocalUser: ${this.myId}\nremoteUser: ${socketId}\ntrackId: ${track.id}\ntrackKind: ${track.kind}\nstreamId: ${this.localStream?.id}\nsignalingState: ${pc.signalingState}\nconnectionState: ${pc.connectionState}\niceConnectionState: ${pc.iceConnectionState}`);
  }

  createPeerConnection(socketId) {
    console.log(`[WEBRTC][PEER-COUNT]\nlocalUser: ${this.myId}\nremoteUser: ${socketId}\nexistingPeer: ${this.peerConnections.has(socketId)}`);
    
    if (this.peerConnections.has(socketId)) {
      const existingPc = this.peerConnections.get(socketId);
      if (existingPc.connectionState !== "closed") {
        console.log(`[WEBRTC] peer already exists for remoteUserId: ${socketId}`);
        return existingPc;
      }
    }

    console.log(`[WEBRTC] create peer\nroomId: unknown\nlocalUserId: ${this.myId}\nremoteUserId: ${socketId}`);

    const pc = new RTCPeerConnection(this.getIceConfig());
    this.peerConnections.set(socketId, pc);

    pc.onnegotiationneeded = () => {
      const isPolite = String(this.myId).localeCompare(String(socketId)) > 0;
      console.log(`[WEBRTC][NEGOTIATIONNEEDED]\nlocalUser: ${this.myId}\nremoteUser: ${socketId}\nsignalingState: ${pc.signalingState}\nconnectionState: ${pc.connectionState}\niceConnectionState: ${pc.iceConnectionState}\nmakingOffer: ${!!this.makingOffer.get(socketId)}\nisPolite: ${isPolite}`);
      this.initiateOffer(socketId);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("signal:ice-candidate", { target: socketId, to: socketId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WEBRTC][REMOTE-TRACK]\nlocalUser: ${this.myId}\nremoteUser: ${socketId}\ntrackId: ${event.track.id}\ntrackKind: ${event.track.kind}\ntrackReadyState: ${event.track.readyState}\ntrackEnabled: ${event.track.enabled}\nstreamId: ${event.streams[0]?.id}\nstreamActive: ${event.streams[0]?.active}\nconnectionState: ${pc.connectionState}\niceConnectionState: ${pc.iceConnectionState}\nsignalingState: ${pc.signalingState}`);
      
      let stream = event.streams && event.streams[0];
      if (!stream) {
        // Reuse existing stream if we have one, otherwise create a new one
        if (this.remoteStreams.has(socketId)) {
          stream = this.remoteStreams.get(socketId);
          stream.addTrack(event.track);
        } else {
          stream = new MediaStream([event.track]);
        }
      }
      
      console.log(`[WEBRTC][REMOTE-STREAM]\nremoteUser: ${socketId}\nstreamId: ${stream.id}\naudioTracks: ${stream.getAudioTracks().length}\nvideoTracks: ${stream.getVideoTracks().length}\nactive: ${stream.active}`);
      
      this.remoteStreams.set(socketId, stream);
      this.onStreamsUpdate(new Map(this.remoteStreams));
      
      const entriesLog = Array.from(this.remoteStreams.entries()).map(([k,v]) => `${k}=${v.id}`).join(', ');
      console.log(`[WEBRTC][REMOTE-STREAMS-STATE]\ncurrentUser: ${this.myId}\nentries: ${entriesLog}`);

      // Update when active state changes or new tracks are added
      stream.onaddtrack = () => this.onStreamsUpdate(new Map(this.remoteStreams));
      stream.onremovetrack = () => this.onStreamsUpdate(new Map(this.remoteStreams));
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WEBRTC] connectionState transition for ${socketId}: ${pc.connectionState}`);
      if (pc.connectionState === "failed") {
        // Try to reconnect cleanly instead of blindly restarting ICE
        console.log(`[WEBRTC] connection failed for ${socketId}, tearing down and recreating`);
        this.removePeer(socketId);
        this.addPeer(socketId, String(this.myId).localeCompare(String(socketId)) < 0);
      } else if (pc.connectionState === "disconnected") {
        // usually temporary, handled by ice reconnects
      }
    };

    pc.onsignalingstatechange = () => {
      console.log(`[WEBRTC] signalingState transition for ${socketId}: ${pc.signalingState}`);
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WEBRTC] iceConnectionState transition for ${socketId}: ${pc.iceConnectionState}`);
    };
    
    pc.onicegatheringstatechange = () => {
      console.log(`[WEBRTC] iceGatheringState transition for ${socketId}: ${pc.iceGatheringState}`);
    };

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try {
          pc.addTrack(track, this.localStream);
          this._logTrackAdd(socketId, track, pc);
        } catch (e) {
          console.warn("Error adding track to peer:", e);
        }
      });
    }

    return pc;
  }

  async initiateOffer(socketId) {
    try {
      if (this.makingOffer.get(socketId)) return;
      this.makingOffer.set(socketId, true);

      let pc = this.peerConnections.get(socketId);
      if (!pc) {
        pc = this.createPeerConnection(socketId);
      }
      
      const hasVideoTransceiver = pc.getTransceivers().some(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'video');
      const videoSenderCount = pc.getSenders().filter(s => s.track && s.track.kind === 'video').length;

      if (this.localStream) {
        const senders = pc.getSenders();
        this.localStream.getTracks().forEach(track => {
          if (!senders.some(s => s.track && s.track.kind === track.kind)) {
            try {
              pc.addTrack(track, this.localStream);
              this._logTrackAdd(socketId, track, pc);
            } catch (e) {
              console.warn("Error attaching track:", e);
            }
          }
        });
      }

      const offer = await pc.createOffer();
      
      console.log(`[WEBRTC][OFFER-CREATED]\nfrom: ${this.myId}\nto: ${socketId}\ntype: ${offer.type}\nsignalingState: ${pc.signalingState}\nhasVideoTransceiver: ${hasVideoTransceiver}\nvideoSenderCount: ${videoSenderCount}`);
      
      await pc.setLocalDescription(offer);
      
      console.log(`[WEBRTC][OFFER-SENT]\nfrom: ${this.myId}\nto: ${socketId}`);
      socket.emit("signal:offer", { target: socketId, to: socketId, offer, sdp: offer });
    } catch (err) {
      console.error("Error initiating offer for", socketId, err);
    } finally {
      this.makingOffer.set(socketId, false);
    }
  }

  async handleReady(fromSocketId) {
    console.log(`[WEBRTC] handleReady called for peer ${fromSocketId}. My ID: ${this.myId}`);
    if (!fromSocketId || fromSocketId === this.myId) return;
    
    // Either side can negotiate.
    this.addPeer(fromSocketId, false);
  }

  async addPeer(socketId, forceInitiator = false) {
    if (this.peerConnections.has(socketId)) {
      const pc = this.peerConnections.get(socketId);
      if (pc.connectionState === "connected") return;
    }

    this.createPeerConnection(socketId);
    
    if (forceInitiator) {
      await this.initiateOffer(socketId);
    }
  }

  async flushPendingCandidates(socketId, pc) {
    if (this.pendingCandidates.has(socketId)) {
      const candidates = this.pendingCandidates.get(socketId);
      this.pendingCandidates.delete(socketId);
      console.log(`[WEBRTC] flushing ${candidates.length} pending ICE candidates for ${socketId}`);
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn("Error adding buffered ICE candidate:", e);
        }
      }
    }
  }

  async handleOffer(socketId, sdpOrOffer) {
    console.log(`[WEBRTC][OFFER-RECEIVED]\nfrom: ${socketId}\nto: ${this.myId}`);
    try {
      let pc = this.peerConnections.get(socketId);
      if (!pc) {
        pc = this.createPeerConnection(socketId);
      }

      const isPolite = String(this.myId).localeCompare(String(socketId)) > 0;
      const offerCollision = (this.makingOffer.get(socketId) || pc.signalingState !== "stable");

      this.ignoreOffer.set(socketId, !isPolite && offerCollision);

      console.log(`[WEBRTC][OFFER-DECISION]\nfrom: ${socketId}\nto: ${this.myId}\nofferCollision: ${offerCollision}\npolite: ${isPolite}\nignoreOffer: ${this.ignoreOffer.get(socketId)}\nsignalingState: ${pc.signalingState}`);

      if (this.ignoreOffer.get(socketId)) {
        console.log(`[WEBRTC] offer collision, ignoring offer from ${socketId} as impolite peer`);
        return;
      }

      if (offerCollision && isPolite) {
        console.log(`[WEBRTC][ROLLBACK]\nlocalUser: ${this.myId}\nremoteUser: ${socketId}\nbeforeState: ${pc.signalingState}\nafterState: rollback in progress`);
        try {
          // Note: rollback is implicitly done by setting the remote offer, but let's be explicit if needed
          await Promise.all([
            pc.setLocalDescription({ type: "rollback" }),
            pc.setRemoteDescription(new RTCSessionDescription(sdpOrOffer))
          ]);
        } catch (e) {
          console.log(`[WEBRTC] rollback failed, setting remote description anyway for ${socketId}`, e);
          await pc.setRemoteDescription(new RTCSessionDescription(sdpOrOffer));
        }
      } else {
          await pc.setRemoteDescription(new RTCSessionDescription(sdpOrOffer));
      }

      await this.flushPendingCandidates(socketId, pc);

      if (this.localStream) {
        const senders = pc.getSenders();
        this.localStream.getTracks().forEach(track => {
          if (!senders.some(s => s.track && s.track.kind === track.kind)) {
            try {
              pc.addTrack(track, this.localStream);
              this._logTrackAdd(socketId, track, pc);
            } catch (e) {
              console.warn("Error adding track on offer:", e);
            }
          }
        });
      }

      const answer = await pc.createAnswer();
      console.log(`[WEBRTC][ANSWER-CREATED]\nfrom: ${this.myId}\nto: ${socketId}`);
      await pc.setLocalDescription(answer);
      
      console.log(`[WEBRTC][ANSWER-SENT]\nfrom: ${this.myId}\nto: ${socketId}`);
      socket.emit("signal:answer", { target: socketId, to: socketId, answer, sdp: answer });
    } catch (err) {
      console.error("Error handling offer from", socketId, err);
    }
  }

  async handleAnswer(socketId, sdpOrAnswer) {
    console.log(`[WEBRTC][ANSWER-RECEIVED]\nfrom: ${socketId}\nto: ${this.myId}`);
    try {
      const pc = this.peerConnections.get(socketId);
      if (pc && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(sdpOrAnswer));
        await this.flushPendingCandidates(socketId, pc);
      } else if (pc) {
        console.log(`[WEBRTC] ignored answer from ${socketId} because signalingState is ${pc.signalingState}`);
      }
    } catch (err) {
      console.error("Error handling answer from", socketId, err);
    }
  }

  async handleIceCandidate(socketId, candidate) {
    if (!candidate) return;
    try {
      const pc = this.peerConnections.get(socketId);
      if (this.ignoreOffer.get(socketId)) {
          return;
      }
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        console.log(`[WEBRTC] buffering ICE candidate for ${socketId}`);
        if (!this.pendingCandidates.has(socketId)) {
          this.pendingCandidates.set(socketId, []);
        }
        this.pendingCandidates.get(socketId).push(candidate);
      }
    } catch (err) {
      console.warn("Failed to add ICE candidate", err);
    }
  }

  updateLocalStream(stream) {
    this.localStream = stream;
    if (!stream) return;

    this.peerConnections.forEach((pc, socketId) => {
      const senders = pc.getSenders();
      stream.getTracks().forEach(track => {
        const sender = senders.find(s => s.track && s.track.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track).catch(e => console.warn("replaceTrack error:", e));
        } else {
          try {
            pc.addTrack(track, stream);
            this._logTrackAdd(socketId, track, pc);
          } catch (e) {
            console.warn("addTrack error:", e);
          }
        }
      });

      if (!this.makingOffer.get(socketId)) {
        this.initiateOffer(socketId);
      }
    });
  }

  updateParticipants(roomParticipants) {
    if (!roomParticipants || !Array.isArray(roomParticipants)) return;
    
    console.log(`[ROOM]\nlocalUser: ${this.myId}\nparticipants: ${roomParticipants.map(p => p.id || p.socketId).join(', ')}`);

    const currentPeerIds = new Set(this.peerConnections.keys());
    const validParticipantIds = new Set();

    roomParticipants.forEach(p => {
      const peerId = p.id || p.socketId;
      if (peerId && peerId !== this.myId) {
        validParticipantIds.add(peerId);
        if (!this.peerConnections.has(peerId)) {
          console.log(`[WEBRTC] new participant discovered from participants list: ${peerId}`);
          this.addPeer(peerId, false);
        }
      }
    });

    currentPeerIds.forEach(peerId => {
      if (!validParticipantIds.has(peerId)) {
        console.log(`[WEBRTC] removing participant no longer in room: ${peerId}`);
        this.removePeer(peerId);
      }
    });
  }

  removePeer(socketId) {
    const pc = this.peerConnections.get(socketId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(socketId);
    }
    this.pendingCandidates.delete(socketId);
    this.makingOffer.delete(socketId);
    this.ignoreOffer.delete(socketId);
    if (this.remoteStreams.has(socketId)) {
      this.remoteStreams.delete(socketId);
      this.onStreamsUpdate(new Map(this.remoteStreams));
    }
  }

  cleanup() {
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.pendingCandidates.clear();
    this.makingOffer.clear();
    this.ignoreOffer.clear();
    this.remoteStreams.clear();
  }
}
