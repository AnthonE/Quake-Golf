# Quake Golf for the original Xbox, with nxdk (github.com/XboxDev/nxdk).
#
#   sh tools/install-nxdk.sh   # once: nxdk, pinned, into .tools/nxdk
#   make -C xbox [SERVER=host:port] [GOLFER=qg2:...]   # bin/default.xbe and Quake Golf.iso
#
# SERVER is the relay's native port for online play, written beside the XBE
# (and into the ISO) as quakegolf.txt; the title screen can change it too.
# The default is the machine running xemu, as xemu's NAT network sees it.
#
# The sim is the Xbox's own, xbox/sim/ (a frozen fork of src/: the browsers'
# sim is free to change its bits, this one is not), assembled to
# build/xbox/game.wasm and translated to Pentium III assembly (tools/w2x86.mjs,
# COFF flavour); this rebuilds it when the WAT changes.

XBE_TITLE = Quake\ Golf
GEN_XISO = $(XBE_TITLE).iso
ROOT := $(abspath $(CURDIR)/..)
NXDK_DIR ?= $(ROOT)/.tools/nxdk
NXDK_SDL = y
NXDK_NET = y
SERVER ?= 10.0.2.2:4434
GEN := $(ROOT)/build/x86
SIM := $(GEN)/game-coff.s
SRCS = $(CURDIR)/main.c $(CURDIR)/game.c $(CURDIR)/brain.c $(CURDIR)/online.c $(CURDIR)/inflate.c $(CURDIR)/net_xbox.c $(SIM)
CFLAGS += -I$(GEN) -O2
export NXDK_DIR
export PATH := $(NXDK_DIR)/bin:$(PATH)

include $(NXDK_DIR)/Makefile

$(ROOT)/build/xbox/game.wasm: $(wildcard $(CURDIR)/sim/*.wat) $(CURDIR)/sim/layout.mjs $(CURDIR)/sim/macros.mjs $(ROOT)/tools/asm.mjs
	cd $(ROOT) && node tools/asm.mjs

$(SIM) $(GEN)/qg_sim.h $(GEN)/layout.h $(GEN)/font.h &: $(ROOT)/build/xbox/game.wasm $(ROOT)/tools/w2x86.mjs $(ROOT)/tools/x86.mjs $(ROOT)/client/font.mjs
	cd $(ROOT) && node tools/x86.mjs --no-runner

$(CURDIR)/main.obj $(CURDIR)/game.obj $(CURDIR)/brain.obj $(CURDIR)/online.obj: $(GEN)/qg_sim.h $(GEN)/layout.h $(GEN)/font.h
$(CURDIR)/main.obj: $(CURDIR)/golfer.h
$(CURDIR)/main.obj $(CURDIR)/game.obj $(CURDIR)/brain.obj: $(CURDIR)/brain.h $(CURDIR)/game.h

# the server, rewritten every build so a new SERVER always lands in the ISO;
# GOLFER=qg2:... puts a neural golfer's genome beside it (Black seats it)
GOLFER ?=
.PHONY: server-file
server-file:
	@mkdir -p $(OUTPUT_DIR) && echo '$(SERVER)' > $(OUTPUT_DIR)/quakegolf.txt
	@$(if $(GOLFER),echo '$(GOLFER)' > $(OUTPUT_DIR)/golfer.txt,rm -f $(OUTPUT_DIR)/golfer.txt)
$(GEN_XISO): server-file
