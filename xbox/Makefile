# Quake Golf for the original Xbox, with nxdk (github.com/XboxDev/nxdk).
#
#   sh tools/install-nxdk.sh   # once: nxdk, pinned, into .tools/nxdk
#   make -C xbox               # bin/default.xbe and Quake Golf.iso
#
# The sim is build/game.wasm translated to Pentium III assembly
# (tools/w2x86.mjs, COFF flavour); this rebuilds it when the WAT changes.

XBE_TITLE = Quake\ Golf
GEN_XISO = $(XBE_TITLE).iso
ROOT := $(abspath $(CURDIR)/..)
NXDK_DIR ?= $(ROOT)/.tools/nxdk
NXDK_SDL = y
GEN := $(ROOT)/build/x86
SIM := $(GEN)/game-coff.s
SRCS = $(CURDIR)/main.c $(CURDIR)/game.c $(SIM)
CFLAGS += -I$(GEN) -O2
export NXDK_DIR
export PATH := $(NXDK_DIR)/bin:$(PATH)

include $(NXDK_DIR)/Makefile

$(ROOT)/build/game.wasm: $(wildcard $(ROOT)/src/*.wat) $(ROOT)/src/layout.mjs $(ROOT)/src/macros.mjs $(ROOT)/tools/asm.mjs
	cd $(ROOT) && node tools/asm.mjs

$(SIM) $(GEN)/qg_sim.h $(GEN)/layout.h $(GEN)/font.h &: $(ROOT)/build/game.wasm $(ROOT)/tools/w2x86.mjs $(ROOT)/tools/x86.mjs $(ROOT)/client/font.mjs
	cd $(ROOT) && node tools/x86.mjs --no-runner

$(CURDIR)/main.obj $(CURDIR)/game.obj: $(GEN)/qg_sim.h $(GEN)/layout.h $(GEN)/font.h
